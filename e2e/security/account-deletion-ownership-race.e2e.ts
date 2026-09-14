import { expect, test } from "@playwright/test";
import {
  SECURITY_BASE_URL,
  createSecurityTenant,
  destroySecurityTenant,
  securitySql,
  setSecurityTenantRole,
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

function extractTransferForm(html: string, membershipId: string): { path: string; multipart: Record<string, string> } {
  for (const form of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const attributes = form[1] ?? "";
    const body = form[2] ?? "";
    if (!body.includes(`name="membershipId"`) || !body.includes(`value="${membershipId}"`) || !body.includes(">Transfer ownership</button>")) {
      continue;
    }

    const multipart: Record<string, string> = {};
    for (const input of body.matchAll(/<input\b([^>]*)>/gi)) {
      const inputAttributes = input[1] ?? "";
      const name = attributeValue(inputAttributes, "name");
      if (!name) continue;
      multipart[name] = attributeValue(inputAttributes, "value") ?? "";
    }
    const action = attributeValue(attributes, "action") || "/settings/team";
    const target = new URL(action, SECURITY_BASE_URL);
    return { path: `${target.pathname}${target.search}`, multipart };
  }
  throw new Error("Could not find rendered transfer-ownership form");
}

test.describe.serial("account deletion and ownership transfer race", () => {
  let owner: SecurityTenant;
  let deleter: SecurityTenant;
  let targetMembershipId: string;

  test.beforeAll(async () => {
    owner = await createSecurityTenant("ownership-race-owner");
    deleter = await createSecurityTenant("ownership-race-deleter");

    // The disposable workspace created for the deletion actor must not itself
    // make that actor an owner, otherwise account deletion is correctly blocked
    // before the race under test begins.
    await setSecurityTenantRole(deleter, "member");

    const rows = await securitySql`
      INSERT INTO organization_members (organization_id, user_id, role)
      VALUES (${owner.organizationId}::uuid, ${deleter.appUserId}::uuid, 'member')
      RETURNING id
    ` as unknown as Array<{ id: string }>;
    targetMembershipId = rows[0]?.id ?? "";
    if (!targetMembershipId) throw new Error("Could not seed ownership-race membership");
  });

  test.afterAll(async () => {
    if (owner) await destroySecurityTenant(owner);
    if (deleter) await destroySecurityTenant(deleter);
  });

  test("cannot delete a user who concurrently becomes workspace owner", async () => {
    const teamPage = await owner.api.get("/settings/team");
    const html = await teamPage.text();
    expect(teamPage.status(), html).toBe(200);
    const transfer = extractTransferForm(html, targetMembershipId);

    const [transferResponse, deletionResponse] = await Promise.all([
      owner.api.post(transfer.path, {
        multipart: transfer.multipart,
        headers: {
          origin: SECURITY_BASE_URL,
          referer: `${SECURITY_BASE_URL}/settings/team`,
          "sec-fetch-site": "same-origin",
        },
        maxRedirects: 0,
      }),
      deleter.api.post("/api/settings/data/account-deletion", {
        headers: {
          origin: SECURITY_BASE_URL,
          "sec-fetch-site": "same-origin",
        },
        data: { confirmation: "DELETE ACCOUNT" },
      }),
    ]);

    const memberships = await securitySql`
      SELECT user_id AS "userId", role
      FROM organization_members
      WHERE organization_id = ${owner.organizationId}::uuid
      ORDER BY user_id
    ` as unknown as Array<{ userId: string; role: string }>;
    const owners = memberships.filter((membership) => membership.role === "owner");
    expect(owners).toHaveLength(1);

    const deleterUsers = await securitySql`
      SELECT count(*)::int AS count
      FROM users
      WHERE id = ${deleter.appUserId}::uuid
    ` as unknown as Array<{ count: number }>;
    const deleterExists = (deleterUsers[0]?.count ?? 0) === 1;

    if (deletionResponse.status() === 200) {
      expect(deleterExists).toBe(false);
      expect(owners[0]?.userId).toBe(owner.appUserId);
      expect(memberships.some((membership) => membership.userId === deleter.appUserId)).toBe(false);
      expect([200, 201, 202, 204]).not.toContain(transferResponse.status());
      return;
    }

    expect(deletionResponse.status()).toBe(409);
    expect(deleterExists).toBe(true);
    expect(owners[0]?.userId).toBe(deleter.appUserId);
    expect(memberships).toContainEqual({ userId: owner.appUserId, role: "admin" });
  });
});
