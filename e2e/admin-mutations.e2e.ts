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

async function submitServerAction(page: import("@playwright/test").Page, route: string, click: () => Promise<void>) {
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === route,
  );
  await click();
  const response = await responsePromise;
  expect(response.ok(), `server action ${route} failed with ${response.status()}`).toBeTruthy();
}

test.describe("platform admin mutations", () => {
  test.beforeEach(({}, testInfo) => test.skip(desktopOnly(testInfo.project.name), "admin mutations run once on desktop Chromium"));

  test("platform admin manages access, membership, limits, lifecycle, and user state", async ({ page, context }) => {
    const admin = await createTenant("admin-actor");
    const target = await createTenant("admin-target");
    try {
      await grantPlatformAdmin(admin);
      await seedPopulatedWorkspace(target);
      await useTenantSession(context, admin);
      const health = await guardBrowser(page);

      await page.goto(`/admin/access?q=${encodeURIComponent(target.email)}`);
      let accessRow = page.locator("tr").filter({ hasText: target.email }).first();
      await submitServerAction(page, "/admin/access", () => accessRow.getByRole("button", { name: "Grant platform admin" }).click());
      accessRow = page.locator("tr").filter({ hasText: target.email }).first();
      await expect(accessRow).toContainText("active");
      let [targetGrant] = await functionalDb.select().from(schema.platformAdminGrants).where(eq(schema.platformAdminGrants.authUserId, target.authUserId));
      expect(targetGrant?.revokedAt).toBeNull();

      await submitServerAction(page, "/admin/access", () => accessRow.getByRole("button", { name: "Revoke platform admin" }).click());
      accessRow = page.locator("tr").filter({ hasText: target.email }).first();
      await expect(accessRow).toContainText("revoked");
      [targetGrant] = await functionalDb.select().from(schema.platformAdminGrants).where(eq(schema.platformAdminGrants.authUserId, target.authUserId));
      expect(targetGrant?.revokedAt).not.toBeNull();

      await functionalDb.insert(schema.organizationMembers).values({
        organizationId: target.organizationId,
        userId: admin.appUserId,
        role: "member",
      });

      const organizationRoute = `/admin/organizations/${target.organizationId}`;
      await page.goto(organizationRoute);
      const membershipSection = page.getByRole("heading", { name: "Membership support" }).locator("..").locator("..");
      let supportRow = membershipSection.locator("tr").filter({ hasText: admin.email }).first();
      await supportRow.getByLabel(`Role for ${admin.email}`).selectOption("admin");
      await submitServerAction(page, organizationRoute, () => supportRow.getByRole("button", { name: "Save role" }).click());
      supportRow = membershipSection.locator("tr").filter({ hasText: admin.email }).first();
      await expect(supportRow.getByLabel(`Role for ${admin.email}`)).toHaveValue("admin");
      await submitServerAction(page, organizationRoute, () => supportRow.getByRole("button", { name: "Remove membership" }).click());
      await expect(membershipSection.locator("tr").filter({ hasText: admin.email })).toHaveCount(0);

      await page.getByLabel("Plan").fill("e2e-enterprise");
      await page.getByLabel("Contact limit").fill("12345");
      await page.getByLabel("Campaign recipient limit").fill("54321");
      await page.getByLabel("Monthly message limit").fill("98765");
      await submitServerAction(page, organizationRoute, () => page.getByRole("button", { name: "Save plan / limits" }).click());
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
      await expect(page.getByRole("cell", { name: /platform_admin\.granted|membership\.role_changed|organization\.suspended/ }).first()).toBeVisible();
      await health.expectHealthy();
    } finally {
      await destroyTenant(target);
      await destroyTenant(admin);
    }
  });
});