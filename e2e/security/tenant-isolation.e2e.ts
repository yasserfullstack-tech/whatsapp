import { expect, request, test } from "@playwright/test";
import { schema } from "@wa/db";
import {
  closeSecurityDatabase,
  createSecurityTenant,
  destroySecurityTenant,
  securityDb,
  securitySql,
  seedTenantResources,
  type SecurityTenant,
  type TenantResources,
} from "./security-helpers";

const MAX_CSV_BYTES = 250 * 1024 * 1024;

test.describe.serial("cross-tenant and API security boundaries", () => {
  let tenantA: SecurityTenant;
  let tenantB: SecurityTenant;
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
    await seedTenantResources(tenantA.organizationId);
    tenantBResources = await seedTenantResources(tenantB.organizationId);

    const [tenantAPhoneRows, tenantATemplateRows, tenantBPhoneRows, tenantBTemplateRows] = await Promise.all([
      securitySql`SELECT id FROM whatsapp_phone_numbers WHERE organization_id = ${tenantA.organizationId} LIMIT 1`,
      securitySql`SELECT id FROM templates WHERE organization_id = ${tenantA.organizationId} LIMIT 1`,
      securitySql`SELECT id FROM whatsapp_phone_numbers WHERE organization_id = ${tenantB.organizationId} LIMIT 1`,
      securitySql`SELECT id FROM templates WHERE organization_id = ${tenantB.organizationId} LIMIT 1`,
    ]);
    const tenantAPhone = (tenantAPhoneRows as unknown as Array<{ id: string }>)[0];
    const tenantATemplate = (tenantATemplateRows as unknown as Array<{ id: string }>)[0];
    const tenantBPhone = (tenantBPhoneRows as unknown as Array<{ id: string }>)[0];
    const tenantBTemplate = (tenantBTemplateRows as unknown as Array<{ id: string }>)[0];
    const [tenantBList] = await securityDb.insert(schema.contactLists)
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
    const response = await tenantA.api.post(`/api/campaigns/${tenantBResources.campaignId}/control`, { data: { action: "pause" } });
    expect(response.status()).toBe(404);
    expect(await response.json()).toEqual({ error: "Campaign not found" });
  });

  test("Organization A cannot read or queue Organization B import", async () => {
    const read = await tenantA.api.get(`/api/contact-imports/${tenantBResources.contactImportId}`);
    expect(read.status()).toBe(404);
    expect(await read.json()).toEqual({ error: "Import not found" });

    const queue = await tenantA.api.post(`/api/contact-imports/${tenantBResources.contactImportId}`);
    expect(queue.status()).toBe(404);
    expect(await queue.json()).toEqual({ error: "Import not found" });
  });

  test("Organization A cannot change Organization B contact consent", async () => {
    const suppress = await tenantA.api.post(`/api/contacts/${tenantBResources.contactId}/suppress`, {
      data: { reason: "security regression test" },
    });
    expect(suppress.status()).toBe(404);
    expect(await suppress.json()).toEqual({ error: "Contact not found" });

    const restore = await tenantA.api.post(`/api/contacts/${tenantBResources.contactId}/resubscribe`, {
      data: {
        consentSource: "security regression test",
        consentedAt: new Date().toISOString(),
        evidenceNote: "Explicit consent evidence for cross-tenant regression testing.",
        confirmation: true,
      },
    });
    expect(restore.status()).toBe(404);
    expect(await restore.json()).toEqual({ error: "Contact not found" });
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
      await securitySql`UPDATE organization_members SET role = ${role} WHERE organization_id = ${tenantB.organizationId}`;
      expect((await tenantB.api.get("/api/settings/data/export")).status(), `${role} must not export workspace data`).toBe(403);
    }
    await securitySql`UPDATE organization_members SET role = 'admin' WHERE organization_id = ${tenantB.organizationId}`;
    expect((await tenantB.api.get("/api/settings/data/export")).status()).toBe(200);
    await securitySql`UPDATE organization_members SET role = 'owner' WHERE organization_id = ${tenantB.organizationId}`;
  });

  test("workspace owners are not platform administrators", async () => {
    const response = await tenantA.api.get("/admin", { maxRedirects: 0 });
    expect([302, 303, 307, 308]).toContain(response.status());
    expect(response.headers().location).toBe("/dashboard");
  });

  test("stored organization names cannot inject executable markup", async () => {
    const payload = '<script>globalThis.__security_xss=1</script><img src=x onerror="globalThis.__security_xss=2">';
    await securitySql`UPDATE organizations SET name = ${payload} WHERE id = ${tenantB.organizationId}`;
    const response = await tenantB.api.get("/settings/general");
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).not.toContain("<script>globalThis.__security_xss=1</script>");
    expect(html).not.toContain("<img src=x");
  });

  test("rejects oversized, non-CSV, and unconfirmed upload metadata before signing", async () => {
    const base = { defaultCountry: "IQ", optInSource: "security test" };
    const oversized = await tenantB.api.post("/api/contact-imports/presign", {
      data: { ...base, fileName: "contacts.csv", sizeBytes: MAX_CSV_BYTES + 1, confirmedOptIn: true },
    });
    expect(oversized.status()).toBe(400);

    const wrongType = await tenantB.api.post("/api/contact-imports/presign", {
      data: { ...base, fileName: "contacts.xlsx", sizeBytes: 1024, confirmedOptIn: true },
    });
    expect(wrongType.status()).toBe(400);

    const noConsent = await tenantB.api.post("/api/contact-imports/presign", {
      data: { ...base, fileName: "contacts.csv", sizeBytes: 1024, confirmedOptIn: false },
    });
    expect(noConsent.status()).toBe(400);
  });

  test("presigned upload is tenant-scoped, sanitized, expiring, and content-type bound", async () => {
    const response = await tenantB.api.post("/api/contact-imports/presign", {
      data: {
        fileName: "../../private/contacts.csv",
        sizeBytes: 1024,
        defaultCountry: "IQ",
        optInSource: "security test",
        confirmedOptIn: true,
      },
    });
    expect(response.status(), await response.text()).toBe(200);
    const body = await response.json() as {
      importId: string;
      uploadUrl: string;
      contentType: string;
      expiresInSeconds: number;
      maxBytes: number;
    };
    expect(body.contentType).toBe("text/csv");
    expect(body.expiresInSeconds).toBe(1800);
    expect(body.maxBytes).toBe(MAX_CSV_BYTES);

    const url = new URL(body.uploadUrl);
    const path = decodeURIComponent(url.pathname);
    expect(path).toContain(`/${tenantB.organizationId}/contact-imports/${body.importId}/`);
    expect(path).not.toContain("..");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("1800");
    expect(url.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toContain("content-type");
  });

  test("revoked authenticated sessions are rejected", async () => {
    const signOut = await tenantA.api.post("/api/auth/sign-out");
    expect(signOut.ok(), await signOut.text()).toBeTruthy();
    const response = await tenantA.api.get("/api/settings/data/export");
    expect(response.status()).toBe(401);
  });
});
