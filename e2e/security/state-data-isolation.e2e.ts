import { randomUUID } from "node:crypto";
import { expect, request, test } from "@playwright/test";
import { schema } from "../../packages/db/src/index";
import { createRedisClient } from "../../packages/queue/src/index";
import {
  SECURITY_BASE_URL,
  createSecurityTenant,
  destroySecurityTenant,
  securityDb,
  securitySql,
  setSecurityTenantRole,
  type SecurityTenant,
} from "./security-helpers";

async function deleteRedisKey(key: string): Promise<number> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error("REDIS_URL is required for security E2E tests");

  // Honor the logical Redis database selected by the suite runner. Combined CI
  // deliberately moves security tests to DB 15 to isolate Better Auth throttles,
  // while the standalone security workflow uses DB 0.
  const redis = createRedisClient(redisUrl);
  try {
    await redis.connect();
    return await redis.del(key);
  } finally {
    redis.disconnect();
  }
}

test.describe.serial("account state, billing, and data isolation", () => {
  let tenantA: SecurityTenant;
  let tenantB: SecurityTenant;
  let tenantBExportId: string;
  let tenantBExpiredExportId: string;
  const billingSentinel = `TENANT-B-BILLING-${randomUUID()}`;

  test.beforeAll(async () => {
    tenantA = await createSecurityTenant("state-data-a");
    tenantB = await createSecurityTenant("state-data-b");

    tenantBExportId = randomUUID();
    tenantBExpiredExportId = randomUUID();
    await securityDb.insert(schema.dataExportJobs).values([
      {
        id: tenantBExportId,
        organizationId: tenantB.organizationId,
        requestedByUserId: tenantB.appUserId,
        kind: "workspace",
        status: "completed",
        objectKey: `${tenantB.organizationId}/data-exports/${tenantBExportId}/${randomUUID()}.ndjson`,
        fileName: "security-completed.ndjson",
        expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
        completedAt: new Date(),
      },
      {
        id: tenantBExpiredExportId,
        organizationId: tenantB.organizationId,
        requestedByUserId: tenantB.appUserId,
        kind: "workspace",
        status: "completed",
        objectKey: `${tenantB.organizationId}/data-exports/${tenantBExpiredExportId}/${randomUUID()}.ndjson`,
        fileName: "security-expired.ndjson",
        expiresAt: new Date(Date.now() - 60_000),
        completedAt: new Date(Date.now() - 120_000),
      },
    ]);

    const accountRows = await securitySql`
      SELECT id
      FROM billing_accounts
      WHERE organization_id = ${tenantB.organizationId}::uuid
      LIMIT 1
    ` as unknown as Array<{ id: string }>;
    const accountId = accountRows[0]?.id;
    if (!accountId) throw new Error("Could not find security tenant billing account");

    const planId = randomUUID();
    const planVersionId = randomUUID();
    const subscriptionId = randomUUID();
    const entitlementId = randomUUID();
    const usageId = randomUUID();
    const invoiceId = randomUUID();
    const periodStart = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
    const periodEnd = new Date(Date.now() + 29 * 24 * 60 * 60 * 1_000).toISOString();

    await securitySql`
      INSERT INTO plans (id, organization_id, code, name, is_custom)
      VALUES (${planId}::uuid, ${tenantB.organizationId}::uuid, ${`security-${randomUUID()}`}, ${billingSentinel}, true)
    `;
    await securitySql`
      INSERT INTO plan_versions (id, plan_id, version, interval, currency, price_minor)
      VALUES (${planVersionId}::uuid, ${planId}::uuid, 1, 'month', 'USD', 12345)
    `;
    await securitySql`
      INSERT INTO plan_entitlements (id, plan_version_id, key, enabled, limit_value)
      VALUES (${entitlementId}::uuid, ${planVersionId}::uuid, 'monthly_campaign_recipients', true, 9999)
    `;
    await securitySql`
      INSERT INTO subscriptions (
        id, billing_account_id, organization_id, plan_version_id, status, is_manual,
        current_period_start, current_period_end
      ) VALUES (
        ${subscriptionId}::uuid, ${accountId}::uuid, ${tenantB.organizationId}::uuid,
        ${planVersionId}::uuid, 'active', true, ${periodStart}, ${periodEnd}
      )
    `;
    await securitySql`
      INSERT INTO billing_period_usage (
        id, organization_id, subscription_id, entitlement_key, period_start, period_end, quantity
      ) VALUES (
        ${usageId}::uuid, ${tenantB.organizationId}::uuid, ${subscriptionId}::uuid,
        'monthly_campaign_recipients', ${periodStart}, ${periodEnd}, 4321
      )
    `;
    await securitySql`
      INSERT INTO invoices (
        id, organization_id, billing_account_id, subscription_id, invoice_number,
        status, currency, subtotal_minor, total_minor, amount_due_minor, amount_paid_minor
      ) VALUES (
        ${invoiceId}::uuid, ${tenantB.organizationId}::uuid, ${accountId}::uuid,
        ${subscriptionId}::uuid, ${billingSentinel}, 'open', 'USD', 12345, 12345, 12345, 0
      )
    `;
  });

  test.afterAll(async () => {
    if (tenantB) await destroySecurityTenant(tenantB);
    if (tenantA) await destroySecurityTenant(tenantA);
  });

  test("body and query tenant selectors cannot switch the authenticated organization", async () => {
    const segmentName = `tenant-spoof-${randomUUID()}`;
    const create = await tenantA.api.post("/api/audiences/segments", {
      data: {
        organizationId: tenantB.organizationId,
        workspaceId: tenantB.organizationId,
        name: segmentName,
        definition: {
          match: "all",
          filters: [{ field: "phone_e164", operator: "starts_with", value: "+1555" }],
        },
      },
    });
    expect(create.status(), await create.text()).toBe(201);

    const rows = await securitySql`
      SELECT organization_id AS "organizationId"
      FROM audience_segments
      WHERE name = ${segmentName}
    ` as unknown as Array<{ organizationId: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.organizationId).toBe(tenantA.organizationId);

    const exportResponse = await tenantA.api.get(
      `/api/settings/data/export?organizationId=${tenantB.organizationId}&workspaceId=${tenantB.organizationId}`,
    );
    expect(exportResponse.status()).toBe(200);
    const exportBody = await exportResponse.json() as { organization?: { id?: string } };
    expect(exportBody.organization?.id).toBe(tenantA.organizationId);
    expect(exportBody.organization?.id).not.toBe(tenantB.organizationId);
  });

  test("billing, subscription, invoice, and usage data stay inside the workspace", async () => {
    const attacker = await tenantA.api.get("/settings/billing");
    expect(attacker.status()).toBe(200);
    const attackerHtml = await attacker.text();
    expect(attackerHtml).not.toContain(billingSentinel);
    expect(attackerHtml).not.toContain("4,321");

    const owner = await tenantB.api.get("/settings/billing");
    expect(owner.status()).toBe(200);
    const ownerHtml = await owner.text();
    expect(ownerHtml).toContain(billingSentinel);
    expect(ownerHtml).toContain("4,321");
  });

  test("foreign export download ids are non-enumerating and own downloads are short lived", async () => {
    const foreign = await tenantA.api.get(`/api/settings/data/export/${tenantBExportId}/download`);
    expect(foreign.status()).toBe(404);
    expect(await foreign.json()).toEqual({ error: "Export not found" });

    const own = await tenantB.api.get(`/api/settings/data/export/${tenantBExportId}/download`);
    expect(own.status(), await own.text()).toBe(200);
    expect(own.headers()["cache-control"]).toBe("no-store");
    const body = await own.json() as { url: string; expiresInSeconds: number };
    expect(body.expiresInSeconds).toBe(300);
    const signed = new URL(body.url);
    expect(decodeURIComponent(signed.pathname)).toContain(`/${tenantB.organizationId}/data-exports/${tenantBExportId}/`);
    expect(decodeURIComponent(signed.pathname)).not.toContain(tenantA.organizationId);
    expect(signed.searchParams.get("X-Amz-Expires")).toBe("300");
  });

  test("export downloads enforce role and expiry before signing", async () => {
    await setSecurityTenantRole(tenantB, "viewer");
    try {
      const viewer = await tenantB.api.get(`/api/settings/data/export/${tenantBExportId}/download`);
      expect(viewer.status()).toBe(403);
    } finally {
      await setSecurityTenantRole(tenantB, "owner");
    }

    const expired = await tenantB.api.get(`/api/settings/data/export/${tenantBExpiredExportId}/download`);
    expect(expired.status()).toBe(410);
    expect(await expired.json()).toEqual({ error: "Export has expired" });
  });

  test("disabled accounts are blocked from authenticated application APIs", async () => {
    await securityDb.insert(schema.platformUserControls).values({
      userId: tenantA.appUserId,
      disabled: true,
      disabledAt: new Date(),
      disabledReason: "security regression",
    }).onConflictDoUpdate({
      target: schema.platformUserControls.userId,
      set: { disabled: true, disabledAt: new Date(), disabledReason: "security regression" },
    });
    try {
      const response = await tenantA.api.get("/api/settings/data/export", { maxRedirects: 0 });
      expect([302, 303, 307, 308]).toContain(response.status());
      expect(response.headers().location).toBe("/account-disabled");
    } finally {
      await securitySql`
        UPDATE platform_user_controls
        SET disabled = false, disabled_at = NULL, disabled_reason = NULL, updated_at = now()
        WHERE user_id = ${tenantA.appUserId}::uuid
      `;
    }
  });

  test("suspended workspaces cannot use authenticated application APIs", async () => {
    await securityDb.insert(schema.organizationAdminSettings).values({
      organizationId: tenantA.organizationId,
      status: "suspended",
      suspendedAt: new Date(),
      suspendedReason: "security regression",
    }).onConflictDoUpdate({
      target: schema.organizationAdminSettings.organizationId,
      set: { status: "suspended", suspendedAt: new Date(), suspendedReason: "security regression" },
    });
    try {
      const response = await tenantA.api.get("/api/settings/data/export", { maxRedirects: 0 });
      expect([302, 303, 307, 308]).toContain(response.status());
      expect(response.headers().location).toBe("/workspace-suspended");
    } finally {
      await securitySql`
        UPDATE organization_admin_settings
        SET status = 'active', suspended_at = NULL, suspended_reason = NULL, updated_at = now()
        WHERE organization_id = ${tenantA.organizationId}::uuid
      `;
    }
  });

  test("expired sessions are rejected at the public application boundary", async () => {
    const expiredTenant = await createSecurityTenant("expired-session");
    try {
      // Expire the exact token returned by the sign-in used by this request context.
      // Better Auth stores it in both PostgreSQL and the configured secondary store.
      const sessionToken = expiredTenant.sessionToken;
      await securitySql`
        UPDATE auth_session
        SET expires_at = now() - interval '1 minute'
        WHERE token = ${sessionToken}
      `;
      expect(await deleteRedisKey(`wa:auth:${sessionToken}`)).toBe(1);

      const response = await expiredTenant.api.get("/api/settings/data/export");
      expect(response.status()).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
    } finally {
      await destroySecurityTenant(expiredTenant);
    }
  });

  test("sign-in replaces attacker-chosen session tokens and emits hardened cookies", async () => {
    const fixedToken = `attacker-fixed-${randomUUID()}`;
    const fixed = await request.newContext({
      baseURL: SECURITY_BASE_URL,
      extraHTTPHeaders: { cookie: `better-auth.session_token=${fixedToken}` },
    });
    try {
      const before = await fixed.get("/api/settings/data/export");
      expect(before.status()).toBe(401);

      const signIn = await fixed.post("/api/auth/sign-in/email", {
        headers: { origin: SECURITY_BASE_URL, "sec-fetch-site": "same-origin" },
        data: { email: tenantA.email, password: tenantA.password },
      });
      expect(signIn.ok(), await signIn.text()).toBeTruthy();
      const cookies = signIn.headersArray()
        .filter(({ name }) => name.toLowerCase() === "set-cookie")
        .map(({ value }) => value);
      const sessionCookie = cookies.find((value) => value.includes("better-auth.session_token="));
      expect(sessionCookie).toBeTruthy();
      expect(sessionCookie).not.toContain(fixedToken);
      expect(sessionCookie?.toLowerCase()).toContain("httponly");
      expect(sessionCookie?.toLowerCase()).toContain("secure");
      expect(sessionCookie?.toLowerCase()).toContain("samesite=lax");
    } finally {
      await fixed.dispose();
    }
  });
});
