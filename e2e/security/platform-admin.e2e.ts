import { expect, test } from "@playwright/test";
import { schema } from "../../packages/db/src/index";
import {
  SECURITY_BASE_URL,
  createSecurityTenant,
  destroySecurityTenant,
  securityDb,
  securitySql,
  type SecurityTenant,
} from "./security-helpers";

function decodeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function attributeValue(attributes: string, name: string): string | null {
  const match = attributes.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`, "i"));
  return match?.[1] ? decodeHtmlAttribute(match[1]) : null;
}

function extractActionForm(
  html: string,
  fieldName: string,
  fieldValue: string,
  buttonText: string,
): Record<string, string> {
  for (const match of html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/gi)) {
    const body = match[1] ?? "";
    if (!body.includes(`name="${fieldName}"`) || !body.includes(`value="${fieldValue}"`) || !body.includes(buttonText)) continue;
    const multipart: Record<string, string> = {};
    for (const input of body.matchAll(/<input\b([^>]*)>/gi)) {
      const attributes = input[1] ?? "";
      const name = attributeValue(attributes, "name");
      if (!name) continue;
      multipart[name] = attributeValue(attributes, "value") ?? "";
    }
    return multipart;
  }
  throw new Error(`Could not find rendered platform-admin ${buttonText} form`);
}

async function replayAdminAction(
  actor: SecurityTenant,
  pagePath: string,
  multipart: Record<string, string>,
) {
  return actor.api.post(pagePath, {
    multipart,
    headers: {
      origin: SECURITY_BASE_URL,
      referer: `${SECURITY_BASE_URL}${pagePath}`,
      "sec-fetch-site": "same-origin",
    },
    maxRedirects: 0,
  });
}

test.describe.serial("platform administrator authorization", () => {
  let admin: SecurityTenant;
  let attacker: SecurityTenant;
  let victim: SecurityTenant;

  test.beforeAll(async () => {
    admin = await createSecurityTenant("platform-admin");
    attacker = await createSecurityTenant("platform-admin-attacker");
    victim = await createSecurityTenant("platform-admin-victim");
    await securityDb.insert(schema.platformAdminGrants).values({
      authUserId: admin.authUserId,
      source: "security-test",
    });
  });

  test.afterAll(async () => {
    if (victim) await destroySecurityTenant(victim);
    if (attacker) await destroySecurityTenant(attacker);
    if (admin) await destroySecurityTenant(admin);
  });

  test("platform administrator grant is separate from workspace ownership", async () => {
    const adminResponse = await admin.api.get("/admin", { maxRedirects: 0 });
    expect(adminResponse.status()).toBe(200);

    const attackerResponse = await attacker.api.get("/admin", { maxRedirects: 0 });
    expect([302, 303, 307, 308]).toContain(attackerResponse.status());
  });

  test("a normal workspace user cannot replay a valid admin user mutation action", async () => {
    const rendered = await admin.api.get("/admin/users");
    const html = await rendered.text();
    expect(rendered.status(), html).toBe(200);
    const multipart = extractActionForm(html, "userId", attacker.appUserId, "Disable user");
    multipart.reason = "forged non-admin mutation";

    const forged = await replayAdminAction(attacker, "/admin/users", multipart);
    expect([200, 201, 202, 204]).not.toContain(forged.status());

    const controls = await securitySql`
      SELECT disabled
      FROM platform_user_controls
      WHERE user_id = ${attacker.appUserId}::uuid
      LIMIT 1
    ` as unknown as Array<{ disabled: boolean }>;
    expect(controls[0]?.disabled ?? false).toBe(false);
  });

  test("a normal workspace owner cannot replay a valid organization suspension action", async () => {
    const pagePath = `/admin/organizations/${victim.organizationId}`;
    const rendered = await admin.api.get(pagePath);
    const html = await rendered.text();
    expect(rendered.status(), html).toBe(200);
    const multipart = extractActionForm(html, "organizationId", victim.organizationId, "Suspend organization");
    multipart.reason = "forged workspace-owner suspension";

    const forged = await replayAdminAction(attacker, pagePath, multipart);
    expect([200, 201, 202, 204]).not.toContain(forged.status());

    const settings = await securitySql`
      SELECT status, suspended_reason AS "suspendedReason"
      FROM organization_admin_settings
      WHERE organization_id = ${victim.organizationId}::uuid
      LIMIT 1
    ` as unknown as Array<{ status: string; suspendedReason: string | null }>;
    expect(settings[0]?.status ?? "active").not.toBe("suspended");
    expect(settings[0]?.suspendedReason ?? "").not.toContain("forged workspace-owner suspension");
  });

  test("a normal workspace owner cannot replay a valid plan and limit mutation action", async () => {
    const pagePath = `/admin/organizations/${victim.organizationId}`;
    const rendered = await admin.api.get(pagePath);
    const html = await rendered.text();
    expect(rendered.status(), html).toBe(200);
    const multipart = extractActionForm(html, "organizationId", victim.organizationId, "Save plan / limits");
    multipart.plan = "forged-admin-plan";
    multipart.contactLimit = "999999";
    multipart.campaignRecipientLimit = "888888";
    multipart.monthlyMessageLimit = "777777";

    const forged = await replayAdminAction(attacker, pagePath, multipart);
    expect([200, 201, 202, 204]).not.toContain(forged.status());

    const settings = await securitySql`
      SELECT plan, contact_limit AS "contactLimit", campaign_recipient_limit AS "campaignRecipientLimit",
             monthly_message_limit AS "monthlyMessageLimit"
      FROM organization_admin_settings
      WHERE organization_id = ${victim.organizationId}::uuid
      LIMIT 1
    ` as unknown as Array<{
      plan: string | null;
      contactLimit: number | null;
      campaignRecipientLimit: number | null;
      monthlyMessageLimit: number | null;
    }>;
    expect(settings[0]?.plan ?? "standard").not.toBe("forged-admin-plan");
    expect(settings[0]?.contactLimit ?? null).not.toBe(999999);
    expect(settings[0]?.campaignRecipientLimit ?? null).not.toBe(888888);
    expect(settings[0]?.monthlyMessageLimit ?? null).not.toBe(777777);
  });

  test("a normal workspace owner cannot replay a valid organization reactivation action", async () => {
    await securityDb.insert(schema.organizationAdminSettings).values({
      organizationId: victim.organizationId,
      status: "suspended",
      suspendedAt: new Date(),
      suspendedReason: "security fixture",
    }).onConflictDoUpdate({
      target: schema.organizationAdminSettings.organizationId,
      set: { status: "suspended", suspendedAt: new Date(), suspendedReason: "security fixture" },
    });

    try {
      const pagePath = `/admin/organizations/${victim.organizationId}`;
      const rendered = await admin.api.get(pagePath);
      const html = await rendered.text();
      expect(rendered.status(), html).toBe(200);
      const multipart = extractActionForm(html, "organizationId", victim.organizationId, "Reactivate organization");

      const forged = await replayAdminAction(attacker, pagePath, multipart);
      expect([200, 201, 202, 204]).not.toContain(forged.status());

      const settings = await securitySql`
        SELECT status, suspended_reason AS "suspendedReason"
        FROM organization_admin_settings
        WHERE organization_id = ${victim.organizationId}::uuid
        LIMIT 1
      ` as unknown as Array<{ status: string; suspendedReason: string | null }>;
      expect(settings).toEqual([{ status: "suspended", suspendedReason: "security fixture" }]);
    } finally {
      await securitySql`
        UPDATE organization_admin_settings
        SET status = 'active', suspended_at = NULL, suspended_reason = NULL, updated_at = now()
        WHERE organization_id = ${victim.organizationId}::uuid
      `;
    }
  });

  test("disabled accounts cannot retain platform administrator access", async () => {
    await securityDb.insert(schema.platformUserControls).values({
      userId: admin.appUserId,
      disabled: true,
      disabledAt: new Date(),
      disabledReason: "security regression",
    }).onConflictDoUpdate({
      target: schema.platformUserControls.userId,
      set: { disabled: true, disabledAt: new Date(), disabledReason: "security regression" },
    });

    const response = await admin.api.get("/admin", { maxRedirects: 0 });
    expect([302, 303, 307, 308]).toContain(response.status());
    expect(response.headers().location).toBe("/account-disabled");
  });
});
