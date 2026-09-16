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
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function attributeValue(attributes: string, name: string): string | null {
  const match = attributes.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`, "i"));
  return match?.[1] ? decodeHtmlAttribute(match[1]) : null;
}

function extractActionForm(html: string, fieldName: string, fieldValue: string, buttonText: string): Record<string, string> {
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

async function replayAdminAction(actor: SecurityTenant, pagePath: string, multipart: Record<string, string>) {
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

test.describe.serial("expanded platform administrator tooling authorization", () => {
  let admin: SecurityTenant;
  let attacker: SecurityTenant;

  test.beforeAll(async () => {
    admin = await createSecurityTenant("platform-tools-admin");
    attacker = await createSecurityTenant("platform-tools-attacker");
    await securityDb.insert(schema.platformAdminGrants).values({ authUserId: admin.authUserId, source: "security-test" });
  });

  test.afterAll(async () => {
    if (attacker) await destroySecurityTenant(attacker);
    if (admin) await destroySecurityTenant(admin);
  });

  test("workspace users cannot replay the platform-admin grant action", async () => {
    const pagePath = `/admin/access?q=${encodeURIComponent(attacker.email)}`;
    const rendered = await admin.api.get(pagePath);
    const html = await rendered.text();
    expect(rendered.status(), html).toBe(200);
    const multipart = extractActionForm(html, "authUserId", attacker.authUserId, "Grant platform admin");

    const forged = await replayAdminAction(attacker, pagePath, multipart);
    expect([200, 201, 202, 204]).not.toContain(forged.status());

    const grants = await securitySql`
      SELECT revoked_at AS "revokedAt"
      FROM platform_admin_grants
      WHERE auth_user_id = ${attacker.authUserId}
      LIMIT 1
    ` as unknown as Array<{ revokedAt: Date | null }>;
    expect(grants).toEqual([]);
  });

  test("workspace users cannot export the platform audit log", async () => {
    const response = await attacker.api.get("/admin/audit/export", { maxRedirects: 0 });
    expect([302, 303, 307, 308]).toContain(response.status());
    expect(response.headers()["content-type"] ?? "").not.toContain("text/csv");
  });
});
