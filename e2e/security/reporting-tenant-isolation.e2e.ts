import { expect, test } from "@playwright/test";
import {
  closeSecurityDatabase,
  createSecurityTenant,
  destroySecurityTenant,
  securitySql,
  seedTenantResources,
  type SecurityTenant,
  type TenantResources,
} from "./security-helpers";

test.describe.serial("reporting tenant isolation", () => {
  let tenantA: SecurityTenant;
  let tenantB: SecurityTenant;
  let tenantBResources: TenantResources;
  let tenantBCampaignName: string;

  test.beforeAll(async () => {
    tenantA = await createSecurityTenant("reports-a");
    tenantB = await createSecurityTenant("reports-b");
    await seedTenantResources(tenantA.organizationId);
    tenantBResources = await seedTenantResources(tenantB.organizationId);

    const campaignRows = await securitySql`
      SELECT name
      FROM campaigns
      WHERE id = ${tenantBResources.campaignId}
        AND organization_id = ${tenantB.organizationId}
      LIMIT 1
    ` as unknown as Array<{ name: string }>;
    const campaign = campaignRows[0];
    if (!campaign) throw new Error("Could not seed reporting campaign fixture");
    tenantBCampaignName = campaign.name;
  });

  test.afterAll(async () => {
    if (tenantB) await destroySecurityTenant(tenantB);
    if (tenantA) await destroySecurityTenant(tenantA);
    await closeSecurityDatabase();
  });

  test("foreign campaign filters cannot expose another tenant through CSV reports", async () => {
    const path = `/api/reports/export?report=campaigns&range=custom&from=2000-01-01&to=2100-01-01&campaign=${tenantBResources.campaignId}`;

    const attackerResponse = await tenantA.api.get(path);
    expect(attackerResponse.status(), await attackerResponse.text()).toBe(200);
    expect(attackerResponse.headers()["cache-control"]).toContain("no-store");
    const attackerCsv = await attackerResponse.text();
    expect(attackerCsv).not.toContain(tenantBCampaignName);

    const ownerResponse = await tenantB.api.get(path);
    expect(ownerResponse.status(), await ownerResponse.text()).toBe(200);
    expect(await ownerResponse.text()).toContain(tenantBCampaignName);
  });

  test("reports page ignores a foreign campaign id instead of leaking labels or rows", async () => {
    const response = await tenantA.api.get(`/reports/campaigns?range=custom&from=2000-01-01&to=2100-01-01&campaign=${tenantBResources.campaignId}`);
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).not.toContain(tenantBCampaignName);
    expect(html).not.toContain(tenantBResources.campaignId);
  });
});
