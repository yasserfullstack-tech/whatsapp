import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  createSecurityTenant,
  destroySecurityTenant,
  seedTenantResources,
  type SecurityTenant,
  type TenantResources,
} from "./security-helpers";

test.describe.serial("IDOR existence-oracle resistance", () => {
  let tenantA: SecurityTenant;
  let tenantB: SecurityTenant;
  let tenantBResources: TenantResources;

  test.beforeAll(async () => {
    tenantA = await createSecurityTenant("idor-a");
    tenantB = await createSecurityTenant("idor-b");
    tenantBResources = await seedTenantResources(tenantB.organizationId);
  });

  test.afterAll(async () => {
    if (tenantB) await destroySecurityTenant(tenantB);
    if (tenantA) await destroySecurityTenant(tenantA);
  });

  test("foreign campaign IDs are indistinguishable from nonexistent campaign IDs", async () => {
    const foreign = await tenantA.api.get(`/api/campaigns/${tenantBResources.campaignId}`);
    const missing = await tenantA.api.get(`/api/campaigns/${randomUUID()}`);

    expect(foreign.status()).toBe(404);
    expect(missing.status()).toBe(404);
    expect(await foreign.text()).toBe(await missing.text());
  });

  test("foreign import IDs are indistinguishable from nonexistent import IDs", async () => {
    const foreign = await tenantA.api.get(`/api/contact-imports/${tenantBResources.contactImportId}`);
    const missing = await tenantA.api.get(`/api/contact-imports/${randomUUID()}`);

    expect(foreign.status()).toBe(404);
    expect(missing.status()).toBe(404);
    expect(await foreign.text()).toBe(await missing.text());
  });
});
