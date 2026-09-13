import { randomUUID } from "node:crypto";
import { expect, request, type APIRequestContext } from "@playwright/test";
import { createDatabase, schema } from "../../packages/db/src/index";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for security E2E tests");

const database = createDatabase(databaseUrl);
export const securityDb = database.db;

export type SecurityTenant = {
  api: APIRequestContext;
  email: string;
  authUserId: string;
  appUserId: string;
  organizationId: string;
};

export type TenantResources = {
  campaignId: string;
  contactId: string;
  contactImportId: string;
};

function uniqueSuffix(): string {
  return `${Date.now()}-${randomUUID().slice(0, 8)}`;
}

export async function createSecurityTenant(label: string): Promise<SecurityTenant> {
  const suffix = uniqueSuffix();
  const email = `security-${label}-${suffix}@example.test`;
  const password = `Security-${randomUUID()}-A1!`;
  const api = await request.newContext({ baseURL: "http://127.0.0.1:3000" });

  const signUp = await api.post("/api/auth/sign-up/email", {
    data: {
      name: `Security ${label}`,
      email,
      password,
    },
  });
  expect(signUp.ok(), `sign-up failed: ${await signUp.text()}`).toBeTruthy();

  // Any authenticated workspace route forces creation of the application user,
  // organization, and owner membership through ensureWorkspace().
  const bootstrap = await api.post("/api/audiences/segments", {
    data: {
      name: `security-bootstrap-${suffix}`,
      definition: {
        match: "all",
        filters: [{ field: "phone_e164", operator: "starts_with", value: "+1" }],
      },
    },
  });
  expect(bootstrap.status(), `workspace bootstrap failed: ${await bootstrap.text()}`).toBe(201);

  const authRows = await database.client`
    SELECT id
    FROM auth_user
    WHERE email = ${email}
    LIMIT 1
  ` as unknown as Array<{ id: string }>;
  const authUser = authRows[0];
  if (!authUser) throw new Error(`Could not find Better Auth user for ${email}`);

  const workspaceRows = await database.client`
    SELECT u.id AS "appUserId", om.organization_id AS "organizationId"
    FROM users u
    INNER JOIN organization_members om ON om.user_id = u.id
    WHERE u.external_auth_id = ${authUser.id}
    LIMIT 1
  ` as unknown as Array<{ appUserId: string; organizationId: string }>;
  const workspace = workspaceRows[0];
  if (!workspace) throw new Error(`Could not find application workspace for ${email}`);

  return {
    api,
    email,
    authUserId: authUser.id,
    appUserId: workspace.appUserId,
    organizationId: workspace.organizationId,
  };
}

export async function seedTenantResources(organizationId: string): Promise<TenantResources> {
  const suffix = uniqueSuffix();

  const [phone] = await securityDb
    .insert(schema.whatsappPhoneNumbers)
    .values({
      organizationId,
      wabaId: `waba-${suffix}`,
      phoneNumberId: `phone-${suffix}`,
      displayPhoneNumber: "+15550001111",
      verifiedName: "Security Fixture",
      status: "connected",
      credentialKey: `security/${organizationId}/${suffix}`,
    })
    .returning({ id: schema.whatsappPhoneNumbers.id, wabaId: schema.whatsappPhoneNumbers.wabaId });
  if (!phone) throw new Error("Could not seed WhatsApp phone number");

  const [template] = await securityDb
    .insert(schema.templates)
    .values({
      organizationId,
      wabaId: phone.wabaId,
      metaTemplateId: `template-${suffix}`,
      name: `security_template_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
      language: "en",
      category: "marketing",
      status: "approved",
      bodyPreview: "Security test",
      components: [{ type: "BODY", text: "Security test" }],
    })
    .returning({ id: schema.templates.id });
  if (!template) throw new Error("Could not seed template");

  const [contact] = await securityDb
    .insert(schema.contacts)
    .values({
      organizationId,
      phoneE164: `+1555${Math.floor(Math.random() * 1_000_0000).toString().padStart(7, "0")}`,
      displayName: "Tenant B Contact",
      optedIn: true,
      optInSource: "security_test",
      optInAt: new Date(),
    })
    .returning({ id: schema.contacts.id });
  if (!contact) throw new Error("Could not seed contact");

  const [campaign] = await securityDb
    .insert(schema.campaigns)
    .values({
      organizationId,
      whatsappPhoneNumberId: phone.id,
      templateId: template.id,
      name: `Security tenant campaign ${suffix}`,
      status: "sending",
      recipientCount: 1,
    })
    .returning({ id: schema.campaigns.id });
  if (!campaign) throw new Error("Could not seed campaign");

  const contactImportId = randomUUID();
  await securityDb.insert(schema.contactImports).values({
    id: contactImportId,
    organizationId,
    originalFileName: "security.csv",
    objectKey: `${organizationId}/contact-imports/${contactImportId}/security.csv`,
    sizeBytes: 128,
    defaultCountry: "US",
    optInSource: "security_test",
    confirmedOptInAt: new Date(),
    status: "awaiting_upload",
  });

  return {
    campaignId: campaign.id,
    contactId: contact.id,
    contactImportId,
  };
}

export async function destroySecurityTenant(tenant: SecurityTenant): Promise<void> {
  await tenant.api.dispose();

  await database.client`DELETE FROM organizations WHERE id = ${tenant.organizationId}`;
  await database.client`DELETE FROM users WHERE id = ${tenant.appUserId}`;
  await database.client`DELETE FROM auth_user WHERE id = ${tenant.authUserId}`;
}

export async function closeSecurityDatabase(): Promise<void> {
  await database.client.end({ timeout: 5 });
}
