import { expect, test } from "@playwright/test";
import {
  SECURITY_BASE_URL,
  createSecurityTenant,
  destroySecurityTenant,
  securitySql,
  type SecurityTenant,
} from "./security-helpers";

test.describe.serial("workspace deletion concurrency", () => {
  let tenant: SecurityTenant;
  let slug: string;

  test.beforeAll(async () => {
    tenant = await createSecurityTenant("deletion-race");
    const rows = await securitySql`
      SELECT slug
      FROM organizations
      WHERE id = ${tenant.organizationId}::uuid
      LIMIT 1
    ` as unknown as Array<{ slug: string }>;
    slug = rows[0]?.slug ?? "";
    if (!slug) throw new Error("Could not resolve security workspace slug");
  });

  test.afterAll(async () => {
    if (tenant) await destroySecurityTenant(tenant);
  });

  test("only one concurrent destructive request can schedule workspace deletion", async () => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => tenant.api.post("/api/settings/data/workspace-deletion", {
        headers: {
          origin: SECURITY_BASE_URL,
          "sec-fetch-site": "same-origin",
        },
        data: { confirmation: slug, acknowledge: true },
      })),
    );

    const statuses = responses.map((response) => response.status()).sort((a, b) => a - b);
    expect(statuses).toEqual([202, 409, 409, 409, 409]);

    const deletionRows = await securitySql`
      SELECT count(*)::int AS count
      FROM workspace_deletion_requests
      WHERE organization_id = ${tenant.organizationId}::uuid
        AND status = 'cooling_off'
    ` as unknown as Array<{ count: number }>;
    expect(deletionRows[0]?.count).toBe(1);

    const workspaceAudits = await securitySql`
      SELECT count(*)::int AS count
      FROM workspace_audit_logs
      WHERE organization_id = ${tenant.organizationId}::uuid
        AND action = 'workspace.delete.requested'
    ` as unknown as Array<{ count: number }>;
    expect(workspaceAudits[0]?.count).toBe(1);

    const lifecycleAudits = await securitySql`
      SELECT count(*)::int AS count
      FROM data_lifecycle_audit_logs
      WHERE organization_id = ${tenant.organizationId}::uuid
        AND action = 'workspace.delete.requested'
    ` as unknown as Array<{ count: number }>;
    expect(lifecycleAudits[0]?.count).toBe(1);

    const cancel = await tenant.api.delete("/api/settings/data/workspace-deletion", {
      headers: {
        origin: SECURITY_BASE_URL,
        "sec-fetch-site": "same-origin",
      },
    });
    expect(cancel.status(), await cancel.text()).toBe(200);
  });
});
