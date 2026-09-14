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

  const bootstrap = await api.post("/api/audiences/segments", {
    data: {
      name: `bootstrap-${id}`,
      definition: { match: "all", filters: [{ field: "phone_e164", operator: "starts_with", value: "+" }] },
    },
  });
  expect(bootstrap.status(), `workspace bootstrap failed: ${await bootstrap.text()}`).toBe(201);

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
  const cookies = tenant.cookie.split("; ").map((pair) => {
    const index = pair.indexOf("=");
    return { name: pair.slice(0, index), value: pair.slice(index + 1), url: baseURL, sameSite: "Lax" as const };
  });
  await context.addCookies(cookies);
}

export async function seedPopulatedWorkspace(tenant: FunctionalTenant): Promise<PopulatedResources> {
  const id = randomUUID().replaceAll("-", "");
  const credentialKey = `e2e/${tenant.organizationId}/${id}`;
  const encryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!encryptionKey) throw new Error("CREDENTIAL_ENCRYPTION_KEY is required for E2E");
  const encrypted = encryptSecret("e2e-meta-token", encryptionKey);

  await functionalDb.insert(schema.credentialSecrets).values({
    organizationId: tenant.organizationId,
    key: credentialKey,
    ...encrypted,
  });

  const [phone] = await functionalDb.insert(schema.whatsappPhoneNumbers).values({
    organizationId: tenant.organizationId,
    wabaId: `waba-${id}`,
    phoneNumberId: `phone-${id}`,
    displayPhoneNumber: "+15550102030",
    verifiedName: "E2E Business",
    status: "connected",
    qualityRating: "GREEN",
    throughputMps: 80,
    credentialKey,
  }).returning({ id: schema.whatsappPhoneNumbers.id, wabaId: schema.whatsappPhoneNumbers.wabaId, phoneNumberId: schema.whatsappPhoneNumbers.phoneNumberId });
  if (!phone) throw new Error("Could not seed phone number");

  const [template] = await functionalDb.insert(schema.templates).values({
    organizationId: tenant.organizationId,
    wabaId: phone.wabaId,
    metaTemplateId: `template-${id}`,
    name: `e2e_template_${id.slice(0, 12)}`,
    language: "en_US",
    category: "marketing",
    status: "approved",
    metaStatus: "APPROVED",
    bodyPreview: "Hello from E2E",
    components: [{ type: "BODY", text: "Hello from E2E" }],
  }).returning({ id: schema.templates.id });
  if (!template) throw new Error("Could not seed template");

  const contacts = await functionalDb.insert(schema.contacts).values([
    { organizationId: tenant.organizationId, phoneE164: `+1555${id.slice(0, 7).replace(/[a-f]/g, "1")}`, displayName: "Alpha E2E Contact", optedIn: true, optInSource: "e2e", optInAt: new Date() },
    { organizationId: tenant.organizationId, phoneE164: `+1666${id.slice(7, 14).replace(/[a-f]/g, "2")}`, displayName: "Beta E2E Contact", optedIn: true, optInSource: "e2e", optInAt: new Date() },
  ]).returning({ id: schema.contacts.id });
  if (contacts.length !== 2) throw new Error("Could not seed contacts");

  const [campaign] = await functionalDb.insert(schema.campaigns).values({
    organizationId: tenant.organizationId,
    whatsappPhoneNumberId: phone.id,
    templateId: template.id,
    name: `E2E seeded campaign ${id.slice(0, 8)}`,
    status: "sending",
    recipientCount: 0,
  }).returning({ id: schema.campaigns.id });
  if (!campaign) throw new Error("Could not seed campaign");

  return {
    phoneId: phone.id,
    phoneNumberId: phone.phoneNumberId,
    wabaId: phone.wabaId,
    templateId: template.id,
    contactId: contacts[0]!.id,
    secondContactId: contacts[1]!.id,
    campaignId: campaign.id,
  };
}

export async function grantPlatformAdmin(tenant: FunctionalTenant) {
  await functionalDb.insert(schema.platformAdminGrants).values({ authUserId: tenant.authUserId, source: "e2e" })
    .onConflictDoUpdate({ target: schema.platformAdminGrants.authUserId, set: { revokedAt: null, updatedAt: new Date() } });
}

export async function suspendWorkspace(tenant: FunctionalTenant, suspended: boolean) {
  await functionalDb.insert(schema.organizationAdminSettings).values({
    organizationId: tenant.organizationId,
    status: suspended ? "suspended" : "active",
    suspendedAt: suspended ? new Date() : null,
    suspendedReason: suspended ? "E2E suspension" : null,
  }).onConflictDoUpdate({
    target: schema.organizationAdminSettings.organizationId,
    set: { status: suspended ? "suspended" : "active", suspendedAt: suspended ? new Date() : null, suspendedReason: suspended ? "E2E suspension" : null, updatedAt: new Date() },
  });
}

export async function disableUser(tenant: FunctionalTenant, disabled: boolean) {
  await functionalDb.insert(schema.platformUserControls).values({
    userId: tenant.appUserId,
    disabled,
    disabledAt: disabled ? new Date() : null,
    disabledReason: disabled ? "E2E disabled account" : null,
  }).onConflictDoUpdate({
    target: schema.platformUserControls.userId,
    set: { disabled, disabledAt: disabled ? new Date() : null, disabledReason: disabled ? "E2E disabled account" : null, updatedAt: new Date() },
  });
}

export async function capturedEmailUrl(email: string, subject: string): Promise<string> {
  const captureFile = process.env.AUTH_EMAIL_CAPTURE_FILE;
  if (!captureFile) throw new Error("AUTH_EMAIL_CAPTURE_FILE is required for E2E");
  let captured: string | undefined;
  await expect.poll(async () => {
    try {
      const content = await readFile(captureFile, "utf8");
      const messages = content.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { to?: string; subject?: string; text?: string });
      const message = messages.findLast((entry) => entry.to === email && entry.subject === subject);
      captured = message?.text?.match(/https?:\/\/\S+/)?.[0];
      return Boolean(captured);
    } catch {
      return false;
    }
  }, { timeout: 10_000 }).toBe(true);
  if (!captured) throw new Error(`Email ${subject} was not captured for ${email}`);
  return captured;
}

export async function destroyTenant(tenant: FunctionalTenant) {
  await tenant.api.dispose();
  await database.client`DELETE FROM organizations WHERE id = ${tenant.organizationId}`;
  await database.client`DELETE FROM users WHERE id = ${tenant.appUserId}`;
  await database.client`DELETE FROM auth_user WHERE id = ${tenant.authUserId}`;
}

export async function destroyUnverified(authUserId: string | undefined) {
  if (authUserId) await database.client`DELETE FROM auth_user WHERE id = ${authUserId}`;
}

export async function closeFunctionalDatabase() {
  await database.client.end({ timeout: 5 });
}
