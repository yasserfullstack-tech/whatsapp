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
  let tenantBResources: TenantResources;
  const secretSentinel = "SECURITY-EXPORT-SECRET-SENTINEL";

  test.beforeAll(async () => {
    tenantA = await createSecurityTenant("org-a");
    tenantB = await createSecurityTenant("org-b");
    tenantBResources = await seedTenantResources(tenantB.organizationId);
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

  test("forged workspace cookie cannot switch Organization A into Organization B", async () => {
    const forged = await request.newContext({
      baseURL: "http://127.0.0.1:3000",
      extraHTTPHeaders: {
        cookie: `${tenantA.cookie}; wa_workspace_id=${tenantB.organizationId}`,
      },
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
});
