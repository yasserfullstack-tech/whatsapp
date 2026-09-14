import { expect, test } from "@playwright/test";
import {
  createSecurityTenant,
  destroySecurityTenant,
  seedTenantResources,
  type SecurityTenant,
} from "./security-helpers";

test.describe.serial("query abuse boundaries", () => {
  let tenantA: SecurityTenant;
  let tenantB: SecurityTenant;

  test.beforeAll(async () => {
    tenantA = await createSecurityTenant("query-abuse-a");
    tenantB = await createSecurityTenant("query-abuse-b");
    await seedTenantResources(tenantA.organizationId);
    await seedTenantResources(tenantB.organizationId);
  });

  test.afterAll(async () => {
    if (tenantB) await destroySecurityTenant(tenantB);
    if (tenantA) await destroySecurityTenant(tenantA);
  });

  test("SQL metacharacters and LIKE wildcards remain literal tenant-scoped filter values", async () => {
    const payloads = [
      { field: "display_name", operator: "contains", value: `%' OR 1=1 --` },
      { field: "display_name", operator: "starts_with", value: `_'; SELECT pg_sleep(5); --` },
      { field: "phone_e164", operator: "starts_with", value: `+1%' OR 1=1 --` },
    ] as const;

    for (const filter of payloads) {
      const response = await tenantA.api.post("/api/audiences/preview", {
        data: { match: "all", filters: [filter] },
      });
      expect(response.status(), await response.text()).toBe(200);
      const body = await response.json() as {
        count: number;
        sample: Array<{ displayName?: string | null; phoneE164?: string }>;
      };
      expect(body.count).toBe(0);
      expect(body.sample).toEqual([]);
      expect(JSON.stringify(body)).not.toContain("Tenant B Contact");
    }
  });
});
