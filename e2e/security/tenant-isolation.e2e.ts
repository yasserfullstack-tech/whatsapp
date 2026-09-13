import { expect, request, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { schema } from "@wa/db";
import {
  closeSecurityDatabase,
  createSecurityTenant,
  destroySecurityTenant,
  securityDb,
  seedTenantResources,
  type SecurityTenant,
  type TenantResources,
} from "./security-helpers";

test.describe.serial("cross-tenant IDOR isolation", () => {
  let tenantA: SecurityTenant;
  let tenantB: SecurityTenant;
  let tenantAResources: TenantResources;
  let tenantBResources: TenantResources;
  let tenantAPhoneId: string;
  let tenantATemplateId: string;
  let tenantBPhoneId: string;
  let tenantBTemplateId: string;
  let tenantBListId: string;
  const secretSentinel = "SECURITY-EXPORT-SECRET-SENTINEL";

  test.beforeAll(async () => {
    tenantA = await createSecurityTenant("org-a");
    tenantB = await createSecurityTenant("org-b");
    tenantAResources = await seedTenantResources(tenantA.organizationId);
    tenantBResources = await seedTenantResources(tenantB.organizationId);

    const [tenantAPhone] = await securityDb
      .select({ id: schema.whatsappPhoneNumbers.id })
      .from(schema.whatsappPhoneNumbers)
      .where(eq(schema.whatsappPhoneNumbers.organizationId, tenantA.organizationId))
      .limit(1);
    const [tenantATemplate] = await securityDb
      .select({ id: schema.templates.id })
      .from(schema.templates)
      .where(eq(schema.templates.organizationId, tenantA.organizationId))
      .limit(1);
    const [tenantBPhone] = await securityDb
      .select({ id: schema.whatsappPhoneNumbers.id })
      .from(schema.whatsappPhoneNumbers)
      .where(eq(schema.whatsappPhoneNumbers.organizationId, tenantB.organizationId))
      .limit(1);
    const [tenantBTemplate] = await securityDb
      .select({ id: schema.templates.id })
      .from(schema.templates)
      .where(eq(schema.templates.organizationId, tenantB.organizationId))
      .limit(1);
    const [tenantBList] = await securityDb
      .insert(schema.contactLists)
      .values({ organizationId: tenantB.organizationId, name: "Tenant B private list" })
      .returning({ id: schema.contactLists.id });

    if (!tenantAPhone || !tenantATemplate || !tenantBPhone || !tenantBTemplate || !tenantBList) {
      throw new Error("Could not seed cross-tenant security fixtures");
    }
    tenantAPhoneId = tenantAPhone.id;
    tenantATemplateId = tenantATemplate.id;
    tenantBPhoneId = tenantBPhone.id;
    tenantBTemplateId = tenantBTemplate.id;
    tenantBListId = tenantBList.id;

    await securityDb.insert(schema.credentialSecrets).values({
      organizationId: tenantB.organizationId,
      key: `security-export-${tenantB.organizationId}`,
      ciphertext: secretSentinel,
      iv: "security-test-iv",
      authTag: "security-test-auth-tag",
    });
  });

  test.afterAll(async () => {
    if (tenantB) await destroySecurityTenant(tenantB);
    if (tenantA) await destroySecurityTenant(tenantA);
    await closeSecurityDatabase();
  });

  test("Organization A cannot read Organization B campaign", async () => {
    const response = await tenantA.api.get(`/api/campaigns/${tenantBResources.campaignId}`);
    expect(response.status()).toBe(404);
    expect(await response.json()).toEqual({ error: "Campaign not found" });
  });

  test("Organization A cannot control Organization B campaign", async () => {
    const response = await tenantA.api.post(`/api/campaigns/${tenantBResources.campaignId}/control`, {
      data: { action: "pause" },
    });
    expect(response.status()).toBe(404);
    expect(await response.json()).toEqual({ error: "Campaign not found" });
  });

  test("Organization A cannot read Organization B import", async () => {
    const response = await tenantA.api.get(`/api/contact-imports/${tenantBResources.contactImportId}`);
    expect(response.status()).toBe(404);
    expect(await response.json()).toEqual({ error: "Import not found" });
  });

  test("Organization A cannot queue Organization B import", async () => {
    const response = await tenantA.api.post(`/api/contact-imports/${tenantBResources.contactImportId}`);
    expect(response.status()).toBe(404);
    expect(await response.json()).toEqual({ error: "Import not found" });
  });

  test("Organization A cannot suppress Organization B contact", async () => {
    const response = await tenantA.api.post(`/api/contacts/${tenantBResources.contactId}/suppress`, {
      data: { reason: "security regression test" },
    });
    expect(response.status()).toBe(404);
    expect(await response.json()).toEqual({ error: "Contact not found" });
  });

  test("Organization A cannot restore consent for Organization B contact", async () => {
    const response = await tenantA.api.post(`/api/contacts/${tenantBResources.contactId}/resubscribe`, {
      data: {
        consentSource: "security regression test",
        consentedAt: new Date().toISOString(),
        evidenceNote: "Explicit consent evidence for cross-tenant regression testing.",
        confirmation: true,
      },
    });
    expect(response.status()).toBe(404);
    expect(await response.json()).toEqual({ error: "Contact not found" });
  });

  test("Organization A cannot reference Organization B list in a segment", async () => {
    const response = await tenantA.api.post("/api/audiences/segments", {
      data: {
        name: "cross-tenant-list-attack",
        definition: { match: "all", filters: [{ field: "list", operator: "in", value: tenantBListId }] },
      },
    });
    expect(response.status()).toBe(400);
    expect(await response.text()).not.toContain("Tenant B private list");
  });

  test("Organization A cannot create a campaign with Organization B phone number", async () => {
    const response = await tenantA.api.post("/api/campaigns", {
      data: {
        name: "cross-tenant-phone-attack",
        whatsappPhoneNumberId: tenantBPhoneId,
        templateId: tenantATemplateId,
        audience: { type: "all" },
        bindings: [],
      },
    });
    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual({ error: "Choose a connected WhatsApp number" });
  });

  test("Organization A cannot create a campaign with Organization B template", async () => {
    const response = await tenantA.api.post("/api/campaigns", {
      data: {
        name: "cross-tenant-template-attack",
        whatsappPhoneNumberId: tenantAPhoneId,
        templateId: tenantBTemplateId,
        audience: { type: "all" },
        bindings: [],
      },
    });
    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual({ error: "Choose an approved template" });
  });

  test("forged workspace cookie cannot switch Organization A into Organization B", async () => {
    const forged = await request.newContext({
      baseURL: "http://127.0.0.1:3000",
      extraHTTPHeaders: { cookie: `${tenantA.cookie}; wa_workspace_id=${tenantB.organizationId}` },
    });
    try {
      const response = await forged.get("/api/settings/data/export");
      expect(response.status()).toBe(200);
      const body = await response.json() as { organization?: { id?: string } };
      expect(body.organization?.id).toBe(tenantA.organizationId);
      expect(body.organization?.id).not.toBe(tenantB.organizationId);
    } finally {
      await forged.dispose();
    }
  });

  test("workspace export excludes credential secrets and credential keys", async () => {
    const response = await tenantB.api.get("/api/settings/data/export");
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    const text = await response.text();
    expect(text).not.toContain(secretSentinel);
    expect(text).not.toContain("security-test-auth-tag");
    expect(text).not.toContain('"credentialKey"');
  });

  test("workspace data export enforces the role matrix", async () => {
    for (const role of ["viewer", "member"] as const) {
      await securityDb
        .update(schema.organizationMembers)
        .set({ role })
        .where(eq(schema.organizationMembers.organizationId, tenantB.organizationId));
      const response = await tenantB.api.get("/api/settings/data/export");
      expect(response.status(), `${role} must not export workspace data`).toBe(403);
    }
    await securityDb
      .update(schema.organizationMembers)
      .set({ role: "admin" })
      .where(eq(schema.organizationMembers.organizationId, tenantB.organizationId));
    expect((await tenantB.api.get("/api/settings/data/export")).status()).toBe(200);
    await securityDb
      .update(schema.organizationMembers)
      .set({ role: "owner" })
      .where(eq(schema.organizationMembers.organizationId, tenantB.organizationId));
  });

  test("workspace owners are not platform administrators", async () => {
    const response = await tenantA.api.get("/admin", { maxRedirects: 0 });
    expect([302, 303, 307, 308]).toContain(response.status());
    expect(response.headers().location).toBe("/dashboard");
  });

  test("stored organization names cannot inject executable markup", async () => {
    const payload = '<script>globalThis.__security_xss=1</script><img src=x onerror="globalThis.__security_xss=2">';
    await securityDb
      .update(schema.organizations)
      .set({ name: payload, updatedAt: new Date() })
      .where(eq(schema.organizations.id, tenantB.organizationId));
    const response = await tenantB.api.get("/settings/general");
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).not.toContain("<script>globalThis.__security_xss=1</script>");
    expect(html).not.toContain("<img src=x");
  });

  test("expired authenticated sessions are rejected", async () => {
    await securityDb
      .update(schema.authSession)
      .set({ expiresAt: new Date(0), updatedAt: new Date() })
      .where(eq(schema.authSession.userId, tenantA.authUserId));
    const response = await tenantA.api.get("/api/settings/data/export");
    expect(response.status()).toBe(401);
  });

  void tenantAResources;
});
