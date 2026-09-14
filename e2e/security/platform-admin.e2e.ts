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

function extractUserAdminAction(html: string, userId: string): Record<string, string> {
  for (const match of html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/gi)) {
    const body = match[1] ?? "";
    if (!body.includes(`name="userId"`) || !body.includes(`value="${userId}"`) || !body.includes("Disable user")) continue;
    const multipart: Record<string, string> = {};
    for (const input of body.matchAll(/<input\b([^>]*)>/gi)) {
      const attributes = input[1] ?? "";
      const name = attributeValue(attributes, "name");
      if (!name) continue;
      multipart[name] = attributeValue(attributes, "value") ?? "";
    }
    multipart.reason = "forged non-admin mutation";
    return multipart;
  }
  throw new Error("Could not find rendered platform-admin user action form");
}

test.describe.serial("platform administrator authorization", () => {
  let admin: SecurityTenant;
  let attacker: SecurityTenant;

  test.beforeAll(async () => {
    admin = await createSecurityTenant("platform-admin");
    attacker = await createSecurityTenant("platform-admin-attacker");
    await securityDb.insert(schema.platformAdminGrants).values({
      authUserId: admin.authUserId,
      source: "security-test",
    });
  });

  test.afterAll(async () => {
    if (attacker) await destroySecurityTenant(attacker);
    if (admin) await destroySecurityTenant(admin);
  });

  test("platform administrator grant is separate from workspace ownership", async () => {
    const adminResponse = await admin.api.get("/admin", { maxRedirects: 0 });
    expect(adminResponse.status()).toBe(200);

    const attackerResponse = await attacker.api.get("/admin", { maxRedirects: 0 });
    expect([302, 303, 307, 308]).toContain(attackerResponse.status());
  });

  test("a normal workspace user cannot replay a valid admin mutation action", async () => {
    const rendered = await admin.api.get("/admin/users");
    const html = await rendered.text();
    expect(rendered.status(), html).toBe(200);
    const multipart = extractUserAdminAction(html, attacker.appUserId);

    const forged = await attacker.api.post("/admin/users", {
      multipart,
      headers: {
        origin: SECURITY_BASE_URL,
        referer: `${SECURITY_BASE_URL}/admin/users`,
        "sec-fetch-site": "same-origin",
      },
      maxRedirects: 0,
    });
    expect([200, 201, 202, 204]).not.toContain(forged.status());

    const controls = await securitySql`
      SELECT disabled
      FROM platform_user_controls
      WHERE user_id = ${attacker.appUserId}::uuid
      LIMIT 1
    ` as unknown as Array<{ disabled: boolean }>;
    expect(controls[0]?.disabled ?? false).toBe(false);
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
