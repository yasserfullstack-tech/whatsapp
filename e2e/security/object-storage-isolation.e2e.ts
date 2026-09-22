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
  let malformedExportIds: string[];

  test.beforeAll(async () => {
    tenantA = await createSecurityTenant("storage-a");
    tenantB = await createSecurityTenant("storage-b");

    const foreignTenantId = randomUUID();
    const traversalId = randomUUID();
    const duplicateSeparatorId = randomUUID();
    const backslashId = randomUUID();
    const controlCharacterId = randomUUID();
    malformedExportIds = [
      foreignTenantId,
      traversalId,
      duplicateSeparatorId,
      backslashId,
      controlCharacterId,
    ];

    const rows = [
      {
        id: foreignTenantId,
        objectKey: `${tenantA.organizationId}/data-exports/${foreignTenantId}/${randomUUID()}.ndjson`,
      },
      {
        id: traversalId,
        objectKey: `${tenantB.organizationId}/data-exports/${traversalId}/../foreign.ndjson`,
      },
      {
        id: duplicateSeparatorId,
        objectKey: `${tenantB.organizationId}/data-exports/${duplicateSeparatorId}//foreign.ndjson`,
      },
      {
        id: backslashId,
        objectKey: `${tenantB.organizationId}/data-exports/${backslashId}/nested\\foreign.ndjson`,
      },
      {
        id: controlCharacterId,
        objectKey: `${tenantB.organizationId}/data-exports/${controlCharacterId}/foreign\n.ndjson`,
      },
    ];

    await securityDb.insert(schema.dataExportJobs).values(rows.map((row) => ({
      id: row.id,
      organizationId: tenantB.organizationId,
      requestedByUserId: tenantB.appUserId,
      kind: "workspace" as const,
      status: "completed" as const,
      objectKey: row.objectKey,
      fileName: "foreign.ndjson",
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      completedAt: new Date(),
    })));
  });

  test.afterAll(async () => {
    if (tenantB) await destroySecurityTenant(tenantB);
    if (tenantA) await destroySecurityTenant(tenantA);
  });

  test("never signs foreign, traversal-like, or malformed export object keys", async () => {
    for (const exportId of malformedExportIds) {
      const response = await tenantB.api.get(`/api/settings/data/export/${exportId}/download`);
      expect(response.status(), exportId).toBe(409);
      expect(await response.json()).toEqual({ error: "Export storage key is invalid" });
    }
  });
});
