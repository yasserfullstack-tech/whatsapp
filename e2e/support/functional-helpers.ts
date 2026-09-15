import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, request, type APIRequestContext, type BrowserContext } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { encryptSecret } from "../../packages/credentials/src/index";
import { createDatabase, schema } from "../../packages/db/src/index";

const baseURL = "http://127.0.0.1:3000";
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for functional E2E tests");
const database = createDatabase(databaseUrl);
export const functionalDb = database.db;
export const functionalSql = database.client;

export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";
export type FunctionalTenant = {
  api: APIRequestContext;
  cookie: string;
  email: string;
  password: string;
  authUserId: string;
  appUserId: string;
  organizationId: string;
  organizationSlug: string;
  role: WorkspaceRole;
};

export type PopulatedResources = {
  phoneId: string;
  phoneNumberId: string;
  wabaId: string;
  templateId: string;
  contactId: string;
  secondContactId: string;
  campaignId: string;
};

function suffix(label: string) {
  return `${label}-${Date.now()}-${randomUUID().slice(0, 8)}`.toLowerCase().replace(/[^a-z0-9-]/g, "");
}

function cookieHeaderFrom(response: Awaited<ReturnType<APIRequestContext["post"]>>): string {
  const cookies = response.headersArray()
    .filter(({ name }) => name.toLowerCase() === "set-cookie")
    .map(({ value }) => value.split(";", 1)[0])
    .filter(Boolean);
  const header = cookies.join("; ");
  if (!header.includes("better-auth.session_token=")) throw new Error("Better Auth did not return a session cookie");
  return header;
}

export async function createTenant(label: string, role: WorkspaceRole = "owner"): Promise<FunctionalTenant> {
  const id = suffix(label);
  const email = `e2e-${id}@example.test`;
  const password = `E2E-${randomUUID()}-Aa1!`;
  const authApi = await request.newContext({ baseURL });

  const signUp = await authApi.post("/api/auth/sign-up/email", { data: { name: `E2E ${label}`, email, password } });
  expect(signUp.ok(), `sign-up failed: ${await signUp.text()}`).toBeTruthy();

  const authRows = await database.client`SELECT id FROM auth_user WHERE email = ${email} LIMIT 1` as unknown as Array<{ id: string }>;
  const authUserId = authRows[0]?.id;
  if (!authUserId) throw new Error(`Missing auth user for ${email}`);
  await database.client`UPDATE auth_user SET email_verified = true, updated_at = now() WHERE id = ${authUserId}`;

  const signIn = await authApi.post("/api/auth/sign-in/email", { data: { email, password } });
  expect(signIn.ok(), `sign-in failed: ${await signIn.text()}`).toBeTruthy();
  const cookie = cookieHeaderFrom(signIn);
  const api = await request.newContext({ baseURL, extraHTTPHeaders: { cookie } });
  await authApi.dispose();

  const bootstrap = await api.get("/dashboard");
  expect(bootstrap.status(), `workspace bootstrap failed: ${await bootstrap.text()}`).toBe(200);

  const rows = await database.client`
    SELECT u.id AS "appUserId", om.organization_id AS "organizationId", o.slug AS "organizationSlug"
    FROM users u
    JOIN organization_members om ON om.user_id = u.id
    JOIN organizations o ON o.id = om.organization_id
    WHERE u.external_auth_id = ${authUserId}
    LIMIT 1
  ` as unknown as Array<{ appUserId: string; organizationId: string; organizationSlug: string }>;
  const workspace = rows[0];
  if (!workspace) throw new Error(`Missing workspace for ${email}`);

  if (role !== "owner") {
    await functionalDb.update(schema.organizationMembers)
      .set({ role })
      .where(and(eq(schema.organizationMembers.organizationId, workspace.organizationId), eq(schema.organizationMembers.userId, workspace.appUserId)));
  }

  return {
    api,
    cookie,
    email,
    password,
    authUserId,
    appUserId: workspace.appUserId,
    organizationId: workspace.organizationId,
    organizationSlug: workspace.organizationSlug,
    role,
  };
}

export async function createUnverifiedAccount(label: string) {
  const id = suffix(label);
  const email = `unverified-${id}@example.test`;
  const password = `E2E-${randomUUID()}-Aa1!`;
  const api = await request.newContext({ baseURL });
  const response = await api.post("/api/auth/sign-up/email", { data: { name: `Unverified ${label}`, email, password } });
  expect(response.ok(), `unverified sign-up failed: ${await response.text()}`).toBeTruthy();
  const rows = await database.client`SELECT id FROM auth_user WHERE email = ${email} LIMIT 1` as unknown as Array<{ id: string }>;
  await api.dispose();
  return { email, password, authUserId: rows[0]?.id };
}

export async function useTenantSession(context: BrowserContext, tenant: FunctionalTenant) {
  await context.clearCookies();
  const response = await context.request.post(`${baseURL}/api/auth/sign-in/email`, {
    data: { email: tenant.email, password: tenant.password },
  });
  expect(response.ok(), `browser session sign-in failed: ${await response.text()}`).toBeTruthy();
}

export async function seedPopulatedWorkspace(tenant: FunctionalTenant): Promise<PopulatedResources> {
  const credentialId = randomUUID();
  const phoneId = randomUUID();
  const templateId = randomUUID();
  const contactId = randomUUID();
  const secondContactId = randomUUID();
  const campaignId = randomUUID();
  const wabaId = `waba-${tenant.organizationId.slice(0, 8)}`;
  const phoneNumberId = `phone-${tenant.organizationId.slice(0, 8)}`;
  const credentialKey = `org/${tenant.organizationId}/whatsapp/${phoneNumberId}/access-token`;
  const encrypted = encryptSecret("e2e-meta-token", process.env.CREDENTIAL_ENCRYPTION_KEY!);
  const now = new Date();

  await functionalDb.insert(schema.credentialSecrets).values({
    id: credentialId,
    organizationId: tenant.organizationId,
    key: credentialKey,
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
  });
  await functionalDb.insert(schema.whatsappPhoneNumbers).values({
    id: phoneId,
    organizationId: tenant.organizationId,
    wabaId,
    phoneNumberId,
    displayPhoneNumber: "+15550102030",
    verifiedName: "E2E Number",
    status: "connected",
    qualityRating: "GREEN",
    throughputMps: 80,
    credentialKey,
  });
  await functionalDb.insert(schema.templates).values({
    id: templateId,
    organizationId: tenant.organizationId,
    wabaId,
    metaTemplateId: `meta-template-${templateId.slice(0, 8)}`,
    name: "e2e_approved_template",
    language: "en_US",
    status: "approved",
    category: "marketing",
    bodyText: "Hello from E2E",
    components: [{ type: "BODY", text: "Hello from E2E" }],
    variableIndexes: [],
    syncedAt: now,
  });
  await functionalDb.insert(schema.contacts).values([
    { id: contactId, organizationId: tenant.organizationId, phoneE164: "+15550100001", displayName: "Alpha E2E", optedIn: true, optInSource: "e2e" },
    { id: secondContactId, organizationId: tenant.organizationId, phoneE164: "+15550100002", displayName: "Beta E2E", optedIn: true, optInSource: "e2e" },
  ]);
  await functionalDb.insert(schema.campaigns).values({
    id: campaignId,
    organizationId: tenant.organizationId,
    name: "Seeded E2E campaign",
    whatsappPhoneNumberId: phoneId,
    templateId,
    status: "draft",
    recipientCount: 0,
  });
  return { phoneId, phoneNumberId, wabaId, templateId, contactId, secondContactId, campaignId };
}

export async function grantPlatformAdmin(tenant: FunctionalTenant) {
  await functionalDb.insert(schema.platformAdminGrants).values({
    authUserId: tenant.authUserId,
    createdByAuthUserId: tenant.authUserId,
    source: "manual",
  });
}

export async function disableUser(tenant: FunctionalTenant, disabled = true) {
  await functionalDb.insert(schema.platformUserControls).values({
    userId: tenant.appUserId,
    disabled,
    disabledAt: disabled ? new Date() : null,
    disabledReason: disabled ? "E2E disabled" : null,
  }).onConflictDoUpdate({
    target: schema.platformUserControls.userId,
    set: {
      disabled,
      disabledAt: disabled ? new Date() : null,
      disabledReason: disabled ? "E2E disabled" : null,
      updatedAt: new Date(),
    },
  });
}

export async function suspendWorkspace(tenant: FunctionalTenant, suspended = true) {
  await functionalDb.insert(schema.organizationAdminSettings).values({ organizationId: tenant.organizationId, status: suspended ? "suspended" : "active", suspendedAt: suspended ? new Date() : null, suspendedReason: suspended ? "E2E suspended" : null })
    .onConflictDoUpdate({ target: schema.organizationAdminSettings.organizationId, set: { status: suspended ? "suspended" : "active", suspendedAt: suspended ? new Date() : null, suspendedReason: suspended ? "E2E suspended" : null, updatedAt: new Date() } });
}

export async function destroyTenant(tenant: FunctionalTenant) {
  await functionalDb.delete(schema.platformAdminGrants).where(eq(schema.platformAdminGrants.authUserId, tenant.authUserId));
  await functionalDb.delete(schema.platformUserControls).where(eq(schema.platformUserControls.userId, tenant.appUserId));
  await functionalDb.delete(schema.organizations).where(eq(schema.organizations.id, tenant.organizationId));
  await functionalDb.delete(schema.users).where(eq(schema.users.id, tenant.appUserId));
  await functionalSql`DELETE FROM auth_user WHERE id = ${tenant.authUserId}`;
  await tenant.api.dispose();
}

export async function destroyUnverified(authUserId?: string) {
  if (authUserId) await functionalSql`DELETE FROM auth_user WHERE id = ${authUserId}`;
}

export async function capturedEmailUrl(email: string, subject: string) {
  const file = process.env.AUTH_EMAIL_CAPTURE_FILE;
  if (!file) throw new Error("AUTH_EMAIL_CAPTURE_FILE is required");
  let url: string | undefined;
  await expect.poll(async () => {
    try {
      const content = await readFile(file, "utf8");
      const messages = content.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { to?: string; subject?: string; text?: string });
      const message = messages.findLast((entry) => entry.to === email && entry.subject === subject);
      url = message?.text?.match(/https?:\/\/\S+/)?.[0];
      return Boolean(url);
    } catch {
      return false;
    }
  }, { timeout: 10_000 }).toBe(true);
  if (!url) throw new Error(`Email URL not captured for ${email} / ${subject}`);
  return url;
}
