import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { schema } from "../../packages/db/src/index";
import {
  createSecurityTenant,
  destroySecurityTenant,
  securityDb,
  type SecurityTenant,
} from "./security-helpers";

test.describe.serial("object storage isolation", () => {
  let tenantA: SecurityTenant;
  let tenantB: SecurityTenant;
  let malformedExportId: string;

  test.beforeAll(async () => {
    tenantA = await createSecurityTenant("storage-a");
    tenantB = await createSecurityTenant("storage-b");
    malformedExportId = randomUUID();

    await securityDb.insert(schema.dataExportJobs).values({
      id: malformedExportId,
      organizationId: tenantB.organizationId,
      requestedByUserId: tenantB.appUserId,
      kind: "workspace",
      status: "completed",
      objectKey: `${tenantA.organizationId}/data-exports/${malformedExportId}/${randomUUID()}.ndjson`,
      fileName: "foreign.ndjson",
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      completedAt: new Date(),
    });
  });

  test.afterAll(async () => {
    if (tenantB) await destroySecurityTenant(tenantB);
    if (tenantA) await destroySecurityTenant(tenantA);
  });

  test("never signs an export object key outside the authenticated tenant prefix", async () => {
    const response = await tenantB.api.get(`/api/settings/data/export/${malformedExportId}/download`);
    expect(response.status()).toBe(409);
    expect(await response.json()).toEqual({ error: "Export storage key is invalid" });
  });
});
