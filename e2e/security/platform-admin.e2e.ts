import { expect, test } from "@playwright/test";
import { schema } from "../../packages/db/src/index";
import {
  createSecurityTenant,
  destroySecurityTenant,
  securityDb,
  type SecurityTenant,
} from "./security-helpers";

test.describe.serial("platform administrator authorization", () => {
  let tenant: SecurityTenant;

  test.beforeAll(async () => {
    tenant = await createSecurityTenant("platform-admin");
    await securityDb.insert(schema.platformAdminGrants).values({
      authUserId: tenant.authUserId,
      source: "security-test",
    });
  });

  test.afterAll(async () => {
    if (tenant) await destroySecurityTenant(tenant);
  });

  test("platform administrator grant is separate from workspace ownership", async () => {
    const response = await tenant.api.get("/admin", { maxRedirects: 0 });
    expect(response.status()).toBe(200);
  });

  test("disabled accounts cannot retain platform administrator access", async () => {
    await securityDb.insert(schema.platformUserControls).values({
      userId: tenant.appUserId,
      disabled: true,
      disabledAt: new Date(),
      disabledReason: "security regression",
    }).onConflictDoUpdate({
      target: schema.platformUserControls.userId,
      set: { disabled: true, disabledAt: new Date(), disabledReason: "security regression" },
    });

    const response = await tenant.api.get("/admin", { maxRedirects: 0 });
    expect([302, 303, 307, 308]).toContain(response.status());
    expect(response.headers().location).toBe("/account-disabled");
  });
});
