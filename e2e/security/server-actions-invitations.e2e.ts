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

function extractServerActionForm(
  html: string,
  pagePath: string,
  fieldName: string,
  originalValue: string,
  buttonText: string,
): { path: string; multipart: Record<string, string> } {
  const forms = Array.from(html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi));
  for (const form of forms) {
    const attributes = form[1] ?? "";
    const body = form[2] ?? "";
    if (!body.includes(`name="${fieldName}"`) || !body.includes(`value="${originalValue}"`) || !body.includes(`>${buttonText}</button>`)) {
      continue;
    }

    const multipart: Record<string, string> = {};
    for (const input of body.matchAll(/<input\b([^>]*)>/gi)) {
      const inputAttributes = input[1] ?? "";
      const name = attributeValue(inputAttributes, "name");
      if (!name) continue;
      multipart[name] = attributeValue(inputAttributes, "value") ?? "";
    }

    const action = attributeValue(attributes, "action") || pagePath;
    const target = new URL(action, SECURITY_BASE_URL);
    return { path: `${target.pathname}${target.search}`, multipart };
  }
  throw new Error(`Could not find ${buttonText} server-action form for ${fieldName}`);
}

async function submitTamperedServerAction(
  tenant: SecurityTenant,
  pagePath: string,
  fieldName: string,
  originalValue: string,
  foreignValue: string,
  buttonText: string,
): Promise<number> {
  const rendered = await tenant.api.get(pagePath);
  expect(rendered.status(), await rendered.text()).toBe(200);
  const html = await rendered.text();
  const submission = extractServerActionForm(html, pagePath, fieldName, originalValue, buttonText);
  submission.multipart[fieldName] = foreignValue;
  const response = await tenant.api.post(submission.path, {
    multipart: submission.multipart,
    headers: {
      origin: SECURITY_BASE_URL,
      referer: `${SECURITY_BASE_URL}${pagePath}`,
      "sec-fetch-site": "same-origin",
    },
    maxRedirects: 0,
  });
  return response.status();
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
    } finally {
      await wrong.context.close();
    }

    const beforeValidAccept = await securitySql`
      SELECT count(*)::int AS count
      FROM organization_members
      WHERE organization_id = ${tenantA.organizationId}
        AND user_id = ${invitee.appUserId}
    ` as unknown as Array<{ count: number }>;
    expect(beforeValidAccept[0]?.count).toBe(0);

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

  test("hidden membership ids cannot target another workspace", async () => {
    const memberRows = await securitySql`
      SELECT id
      FROM organization_members
      WHERE organization_id = ${tenantA.organizationId}::uuid
        AND user_id = ${invitee.appUserId}::uuid
      LIMIT 1
    ` as unknown as Array<{ id: string }>;
    const tenantAMembershipId = memberRows[0]?.id;
    if (!tenantAMembershipId) throw new Error("Could not find tenant A membership fixture");

    const status = await submitTamperedServerAction(
      tenantA,
      "/settings/team",
      "membershipId",
      tenantAMembershipId,
      tenantBOwnerMembershipId,
      "Remove",
    );
    expect(status).toBeGreaterThanOrEqual(400);

    const victim = await securitySql`
      SELECT role
      FROM organization_members
      WHERE id = ${tenantBOwnerMembershipId}::uuid
        AND organization_id = ${tenantB.organizationId}::uuid
    ` as unknown as Array<{ role: string }>;
    expect(victim).toEqual([{ role: "owner" }]);
  });

  test("hidden WhatsApp ids cannot disconnect another workspace or delete its credential", async () => {
    const phoneRows = await securitySql`
      SELECT id
      FROM whatsapp_phone_numbers
      WHERE organization_id = ${tenantA.organizationId}::uuid
      LIMIT 1
    ` as unknown as Array<{ id: string }>;
    const tenantAPhoneId = phoneRows[0]?.id;
    if (!tenantAPhoneId) throw new Error("Could not find tenant A phone fixture");

    const status = await submitTamperedServerAction(
      tenantA,
      "/settings/whatsapp",
      "phoneNumberId",
      tenantAPhoneId,
      tenantBPhoneId,
      "Disconnect",
    );
    expect(status).toBeGreaterThanOrEqual(400);

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
