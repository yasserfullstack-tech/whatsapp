import { expect, test } from "@playwright/test";
import {
  closeSecurityDatabase,
  createSecurityTenant,
  destroySecurityTenant,
  seedTenantResources,
  type SecurityTenant,
  type TenantResources,
} from "./security-helpers";

test.describe.serial("cross-tenant IDOR isolation", () => {
  let tenantA: SecurityTenant;
  let tenantB: SecurityTenant;
  let tenantBResources: TenantResources;

  test.beforeAll(async () => {
    tenantA = await createSecurityTenant("org-a");
    tenantB = await createSecurityTenant("org-b");
    tenantBResources = await seedTenantResources(tenantB.organizationId);
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
});
