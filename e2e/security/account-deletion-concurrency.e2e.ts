import { expect, test } from "@playwright/test";
import {
  SECURITY_BASE_URL,
  createSecurityTenant,
  destroySecurityTenant,
  securitySql,
  setSecurityTenantRole,
  type SecurityTenant,
} from "./security-helpers";

test.describe.serial("account deletion concurrency", () => {
  let tenant: SecurityTenant;

  test.beforeAll(async () => {
    tenant = await createSecurityTenant("account-deletion-race");
    await setSecurityTenantRole(tenant, "member");
  });

  test.afterAll(async () => {
    if (tenant) await destroySecurityTenant(tenant);
  });

  test("only one concurrent account deletion can complete and audit", async () => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => tenant.api.post("/api/settings/data/account-deletion", {
        headers: {
          origin: SECURITY_BASE_URL,
          "sec-fetch-site": "same-origin",
        },
        data: { confirmation: "DELETE ACCOUNT" },
      })),
    );

    const statuses = responses.map((response) => response.status());
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect(statuses.filter((status) => status !== 200).every((status) => status === 401 || status === 409)).toBe(true);

    const completedAudits = await securitySql`
      SELECT count(*)::int AS count
      FROM data_lifecycle_audit_logs
      WHERE actor_auth_user_id = ${tenant.authUserId}
        AND action = 'account.delete.completed'
    ` as unknown as Array<{ count: number }>;
    expect(completedAudits[0]?.count).toBe(1);

    const users = await securitySql`
      SELECT count(*)::int AS count
      FROM users
      WHERE id = ${tenant.appUserId}::uuid
    ` as unknown as Array<{ count: number }>;
    expect(users[0]?.count).toBe(0);

    const authUsers = await securitySql`
      SELECT count(*)::int AS count
      FROM auth_user
      WHERE id = ${tenant.authUserId}
    ` as unknown as Array<{ count: number }>;
    expect(authUsers[0]?.count).toBe(0);
  });
});
