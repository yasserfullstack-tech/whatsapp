import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { schema } from "../packages/db/src/index";
import {
  createTenant,
  destroyTenant,
  functionalDb,
  grantPlatformAdmin,
  seedPopulatedWorkspace,
  useTenantSession,
} from "./support/functional-helpers";
import { guardBrowser } from "./support/browser-guard";

function desktopOnly(projectName: string) {
  return projectName !== "desktop-1440";
}

test.describe("platform admin mutations", () => {
  test.beforeEach(({}, testInfo) => test.skip(desktopOnly(testInfo.project.name), "admin mutations run once on desktop Chromium"));

  test("platform admin updates limits, suspends/reactivates workspace, and disables/re-enables user", async ({ page, context }) => {
    const admin = await createTenant("admin-actor");
    const target = await createTenant("admin-target");
    try {
      await grantPlatformAdmin(admin);
      await seedPopulatedWorkspace(target);
      await useTenantSession(context, admin);
      const health = await guardBrowser(page);

      await page.goto(`/admin/organizations/${target.organizationId}`);
      await page.getByLabel("Plan").fill("e2e-enterprise");
      await page.getByLabel("Contact limit").fill("12345");
      await page.getByLabel("Campaign recipient limit").fill("54321");
      await page.getByLabel("Monthly message limit").fill("98765");
      await page.getByRole("button", { name: "Save plan / limits" }).click();
      await expect.poll(async () => {
        const [settings] = await functionalDb.select().from(schema.organizationAdminSettings).where(eq(schema.organizationAdminSettings.organizationId, target.organizationId)).limit(1);
        return settings?.plan;
      }).toBe("e2e-enterprise");
      await page.reload();
      await expect(page.getByLabel("Plan")).toHaveValue("e2e-enterprise");
      await expect(page.getByLabel("Contact limit")).toHaveValue("12345");

      await page.getByLabel("Reason").fill("E2E suspension verification");
      await page.getByRole("button", { name: "Suspend organization" }).click();
      await expect(page.getByText("suspended", { exact: true })).toBeVisible();
      const [suspended] = await functionalDb.select().from(schema.organizationAdminSettings).where(eq(schema.organizationAdminSettings.organizationId, target.organizationId));
      expect(suspended?.status).toBe("suspended");

      await page.getByRole("button", { name: "Reactivate organization" }).click();
      await expect(page.getByText("active", { exact: true })).toBeVisible();

      await page.goto("/admin/users");
      let row = page.locator("tr").filter({ hasText: target.email }).first();
      await row.getByLabel("Disable reason").fill("E2E account control verification");
      await row.getByRole("button", { name: "Disable user" }).click();
      row = page.locator("tr").filter({ hasText: target.email }).first();
      await expect(row).toContainText("disabled");
      await row.getByRole("button", { name: "Re-enable" }).click();
      row = page.locator("tr").filter({ hasText: target.email }).first();
      await expect(row).toContainText("active");

      await page.goto("/admin/audit");
      await expect(page.getByText(/suspend|organization/i).first()).toBeVisible();
      await health.expectHealthy();
    } finally {
      await destroyTenant(target);
      await destroyTenant(admin);
    }
  });
});
