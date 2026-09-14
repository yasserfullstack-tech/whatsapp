import { createHash, randomBytes } from "node:crypto";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { schema } from "../../packages/db/src/index";
import {
  SECURITY_BASE_URL,
  createSecurityTenant,
  destroySecurityTenant,
  securityDb,
  securitySql,
  seedTenantResources,
  type SecurityTenant,
  type TenantResources,
} from "./security-helpers";

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function authenticatedPage(browser: Browser, tenant: SecurityTenant): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    extraHTTPHeaders: { cookie: tenant.cookie },
  });
  return { context, page: await context.newPage() };
}

async function waitForServerAction(page: Page, click: () => Promise<void>) {
  const responsePromise = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().startsWith(SECURITY_BASE_URL),
  );
  await click();
  return responsePromise;
}

test.describe.serial("server actions and invitation token security", () => {
  let tenantA: SecurityTenant;
  let tenantB: SecurityTenant;
  let invitee: SecurityTenant;
  let tenantAResources: TenantResources;
  let tenantBResources: TenantResources;
  let inviteToken: string;
  let tenantBOwnerMembershipId: string;
  let tenantBPhoneId: string;
  let tenantBCredentialKey: string;

  test.beforeAll(async () => {
    tenantA = await createSecurityTenant("server-action-a");
    tenantB = await createSecurityTenant("server-action-b");
    invitee = await createSecurityTenant("server-action-invitee");
    tenantAResources = await seedTenantResources(tenantA.organizationId);
    tenantBResources = await seedTenantResources(tenantB.organizationId);

    const ownerRows = await securitySql`
      SELECT id
      FROM organization_members
      WHERE organization_id = ${tenantB.organizationId}
        AND user_id = ${tenantB.appUserId}
      LIMIT 1
    ` as unknown as Array<{ id: string }>;
    const phoneRows = await securitySql`
      SELECT id, credential_key AS "credentialKey"
      FROM whatsapp_phone_numbers
      WHERE organization_id = ${tenantB.organizationId}
      LIMIT 1
    ` as unknown as Array<{ id: string; credentialKey: string }>;
    tenantBOwnerMembershipId = ownerRows[0]?.id ?? "";
    tenantBPhoneId = phoneRows[0]?.id ?? "";
    tenantBCredentialKey = phoneRows[0]?.credentialKey ?? "";
    if (!tenantBOwnerMembershipId || !tenantBPhoneId || !tenantBCredentialKey) {
      throw new Error("Could not seed foreign server-action fixtures");
    }

    await securityDb.insert(schema.credentialSecrets).values({
      organizationId: tenantB.organizationId,
      key: tenantBCredentialKey,
      ciphertext: "server-action-credential-sentinel",
      iv: "server-action-test-iv",
      authTag: "server-action-test-auth-tag",
    });

    inviteToken = randomBytes(32).toString("base64url");
    await securityDb.insert(schema.organizationInvitations).values({
      organizationId: tenantA.organizationId,
      email: invitee.email,
      role: "member",
      tokenHash: tokenHash(inviteToken),
      invitedByUserId: tenantA.appUserId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
    });
  });

  test.afterAll(async () => {
    if (invitee) await destroySecurityTenant(invitee);
    if (tenantB) await destroySecurityTenant(tenantB);
    if (tenantA) await destroySecurityTenant(tenantA);
  });

  test("valid invitation is email-bound, single-use, and joins only the invited workspace", async ({ browser }) => {
    const wrongEmailToken = randomBytes(32).toString("base64url");
    await securityDb.insert(schema.organizationInvitations).values({
      organizationId: tenantA.organizationId,
      email: tenantB.email,
      role: "admin",
      tokenHash: tokenHash(wrongEmailToken),
      invitedByUserId: tenantA.appUserId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
    });

    const wrong = await authenticatedPage(browser, invitee);
    try {
      await wrong.page.goto(`/invite/${wrongEmailToken}`);
      const response = await waitForServerAction(wrong.page, () => wrong.page.getByRole("button", { name: "Accept invitation" }).click());
      expect(response.status()).toBeGreaterThanOrEqual(400);
      const leaked = await response.text();
      expect(leaked).not.toContain(tenantB.email);
      expect(leaked).not.toContain(tenantB.organizationId);
    } finally {
      await wrong.context.close();
    }

    const accepted = await authenticatedPage(browser, invitee);
    try {
      await accepted.page.goto(`/invite/${inviteToken}`);
      await waitForServerAction(accepted.page, () => accepted.page.getByRole("button", { name: "Accept invitation" }).click());
      await accepted.page.waitForURL(/\/settings\/team/);
    } finally {
      await accepted.context.close();
    }

    const memberships = await securitySql`
      SELECT role
      FROM organization_members
      WHERE organization_id = ${tenantA.organizationId}
        AND user_id = ${invitee.appUserId}
    ` as unknown as Array<{ role: string }>;
    expect(memberships).toEqual([{ role: "member" }]);

    const replay = await authenticatedPage(browser, invitee);
    try {
      await replay.page.goto(`/invite/${inviteToken}`);
      const response = await waitForServerAction(replay.page, () => replay.page.getByRole("button", { name: "Accept invitation" }).click());
      expect(response.status()).toBeGreaterThanOrEqual(400);
      expect(await response.text()).not.toContain(tenantA.organizationId);
    } finally {
      await replay.context.close();
    }

    const afterReplay = await securitySql`
      SELECT count(*)::int AS count
      FROM organization_members
      WHERE organization_id = ${tenantA.organizationId}
        AND user_id = ${invitee.appUserId}
    ` as unknown as Array<{ count: number }>;
    expect(afterReplay[0]?.count).toBe(1);
  });

  test("expired invitations cannot create workspace membership", async ({ browser }) => {
    const expiredToken = randomBytes(32).toString("base64url");
    await securityDb.insert(schema.organizationInvitations).values({
      organizationId: tenantA.organizationId,
      email: tenantB.email,
      role: "admin",
      tokenHash: tokenHash(expiredToken),
      invitedByUserId: tenantA.appUserId,
      expiresAt: new Date(Date.now() - 60_000),
    });

    const browserSession = await authenticatedPage(browser, tenantB);
    try {
      await browserSession.page.goto(`/invite/${expiredToken}`);
      const response = await waitForServerAction(
        browserSession.page,
        () => browserSession.page.getByRole("button", { name: "Accept invitation" }).click(),
      );
      expect(response.status()).toBeGreaterThanOrEqual(400);
    } finally {
      await browserSession.context.close();
    }

    const membership = await securitySql`
      SELECT count(*)::int AS count
      FROM organization_members
      WHERE organization_id = ${tenantA.organizationId}
        AND user_id = ${tenantB.appUserId}
    ` as unknown as Array<{ count: number }>;
    expect(membership[0]?.count).toBe(0);
  });

  test("hidden membership ids cannot target another workspace", async ({ browser }) => {
    const browserSession = await authenticatedPage(browser, tenantA);
    try {
      await browserSession.page.goto("/settings/team");
      const row = browserSession.page.locator(".settingsListRow").filter({ hasText: invitee.email });
      await expect(row).toBeVisible();
      const removeForm = row.locator("form").filter({ has: row.getByRole("button", { name: "Remove" }) });
      const hidden = removeForm.locator('input[name="membershipId"]');
      await hidden.evaluate((element, foreignId) => {
        (element as HTMLInputElement).value = foreignId;
      }, tenantBOwnerMembershipId);

      const response = await waitForServerAction(browserSession.page, () => removeForm.getByRole("button", { name: "Remove" }).click());
      expect(response.status()).toBeGreaterThanOrEqual(400);
      const body = await response.text();
      expect(body).not.toContain(tenantB.email);
      expect(body).not.toContain(tenantB.organizationId);
    } finally {
      await browserSession.context.close();
    }

    const victim = await securitySql`
      SELECT role
      FROM organization_members
      WHERE id = ${tenantBOwnerMembershipId}::uuid
        AND organization_id = ${tenantB.organizationId}::uuid
    ` as unknown as Array<{ role: string }>;
    expect(victim).toEqual([{ role: "owner" }]);
  });

  test("hidden WhatsApp ids cannot disconnect another workspace or delete its credential", async ({ browser }) => {
    const browserSession = await authenticatedPage(browser, tenantA);
    try {
      await browserSession.page.goto("/settings/whatsapp");
      const row = browserSession.page.locator(".settingsPhoneRow").first();
      await expect(row).toBeVisible();
      const form = row.locator("form").filter({ has: row.getByRole("button", { name: "Disconnect" }) });
      const hidden = form.locator('input[name="phoneNumberId"]');
      await hidden.evaluate((element, foreignId) => {
        (element as HTMLInputElement).value = foreignId;
      }, tenantBPhoneId);

      const response = await waitForServerAction(browserSession.page, () => form.getByRole("button", { name: "Disconnect" }).click());
      expect(response.status()).toBeGreaterThanOrEqual(400);
      expect(await response.text()).not.toContain(tenantBCredentialKey);
    } finally {
      await browserSession.context.close();
    }

    const phones = await securitySql`
      SELECT status
      FROM whatsapp_phone_numbers
      WHERE id = ${tenantBPhoneId}::uuid
        AND organization_id = ${tenantB.organizationId}::uuid
    ` as unknown as Array<{ status: string }>;
    expect(phones).toEqual([{ status: "connected" }]);
    const credentials = await securitySql`
      SELECT count(*)::int AS count
      FROM credential_secrets
      WHERE organization_id = ${tenantB.organizationId}::uuid
        AND key = ${tenantBCredentialKey}
    ` as unknown as Array<{ count: number }>;
    expect(credentials[0]?.count).toBe(1);
  });
});
