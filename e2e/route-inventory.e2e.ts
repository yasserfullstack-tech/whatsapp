import { expect, test } from "@playwright/test";
import {
  capturedEmailUrl,
  createTenant,
  createUnverifiedAccount,
  destroyTenant,
  destroyUnverified,
  disableUser,
  functionalDb,
  grantPlatformAdmin,
  seedPopulatedWorkspace,
  suspendWorkspace,
  useTenantSession,
} from "./support/functional-helpers";
import { guardBrowser, expectNoHorizontalOverflow } from "./support/browser-guard";
import { and, eq } from "drizzle-orm";
import { schema } from "../packages/db/src/index";

const deepOnly = (projectName: string) => projectName !== "desktop-1440";

const protectedRoutes = [
  "/dashboard", "/contacts", "/audiences", "/templates", "/campaigns", "/reports", "/notifications", "/onboarding",
  "/settings", "/settings/general", "/settings/team", "/settings/whatsapp", "/settings/security", "/settings/billing", "/settings/data", "/settings/notifications",
  "/account/security", "/admin",
];

const ownerRoutes = [
  "/dashboard", "/contacts", "/audiences", "/templates", "/campaigns",
  "/reports", "/reports/campaigns", "/reports/templates", "/reports/audiences", "/reports/phone-numbers",
  "/notifications", "/onboarding", "/settings", "/settings/general", "/settings/team", "/settings/whatsapp",
  "/settings/security", "/settings/billing", "/settings/data", "/settings/notifications", "/account/security",
];

const adminRoutes = [
  "/admin", "/admin/organizations", "/admin/users", "/admin/campaigns", "/admin/connections", "/admin/imports",
  "/admin/webhooks", "/admin/system", "/admin/audit",
];

test.describe("full route and authorization inventory", () => {
  test.beforeEach(({}, testInfo) => test.skip(deepOnly(testInfo.project.name), "deep route inventory runs once on desktop Chromium"));

  test("anonymous users are redirected away from every protected route", async ({ page }) => {
    const health = await guardBrowser(page);
    for (const route of protectedRoutes) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
    }
    await health.expectHealthy();
  });

  test("verified populated owner can render every application/settings route plus campaign detail", async ({ page, context }) => {
    const tenant = await createTenant("owner-route-inventory");
    try {
      const resources = await seedPopulatedWorkspace(tenant);
      await useTenantSession(context, tenant);
      const health = await guardBrowser(page);

      for (const route of [...ownerRoutes, `/campaigns/${resources.campaignId}`]) {
        const response = await page.goto(route);
        expect(response?.status() ?? 200, route).toBeLessThan(500);
        await expect(page.locator("body"), route).toBeVisible();
        await expect(page).not.toHaveURL(/\/sign-in(?:\?|$)/);
        await expectNoHorizontalOverflow(page);
      }
      await health.expectHealthy();
    } finally {
      await destroyTenant(tenant);
    }
  });

  test("platform administrator can render every admin route including organization detail", async ({ page, context }) => {
    const tenant = await createTenant("platform-admin");
    try {
      await seedPopulatedWorkspace(tenant);
      await grantPlatformAdmin(tenant);
      await useTenantSession(context, tenant);
      const health = await guardBrowser(page);

      for (const route of [...adminRoutes, `/admin/organizations/${tenant.organizationId}`]) {
        const response = await page.goto(route);
        expect(response?.status() ?? 200, route).toBeLessThan(500);
        await expect(page).not.toHaveURL(/\/dashboard$/);
        await expect(page.locator("body"), route).toBeVisible();
        await expectNoHorizontalOverflow(page);
      }
      await health.expectHealthy();
    } finally {
      await destroyTenant(tenant);
    }
  });

  test("disabled account and suspended workspace are enforced server-side", async ({ page, context }) => {
    const disabled = await createTenant("disabled-state");
    try {
      await useTenantSession(context, disabled);
      await disableUser(disabled, true);
      await page.goto("/contacts");
      await expect(page).toHaveURL(/\/account-disabled$/);
      await expect(page.getByRole("heading", { name: /account disabled/i })).toBeVisible();
    } finally {
      await destroyTenant(disabled);
    }

    await context.clearCookies();
    const suspended = await createTenant("suspended-state");
    try {
      await useTenantSession(context, suspended);
      await suspendWorkspace(suspended, true);
      await page.goto("/dashboard");
      await expect(page).toHaveURL(/\/workspace-suspended$/);
      await expect(page.getByRole("heading", { name: /workspace suspended/i })).toBeVisible();
    } finally {
      await destroyTenant(suspended);
    }
  });

  test("member and viewer mutation visibility matches server role policy", async ({ page, context }) => {
    const member = await createTenant("member-permissions", "member");
    const viewer = await createTenant("viewer-permissions", "viewer");
    const admin = await createTenant("admin-permissions", "admin");
    try {
      const memberResources = await seedPopulatedWorkspace(member);
      await useTenantSession(context, member);
      await page.goto("/contacts");
      await expect(page.getByRole("button", { name: "Suppress" }).first()).toBeVisible();
      await functionalDb.update(schema.contacts).set({ optedIn: false, unsubscribedAt: new Date() }).where(and(eq(schema.contacts.organizationId, member.organizationId), eq(schema.contacts.id, memberResources.contactId)));
      await page.reload();
      await expect(page.getByRole("button", { name: "Record new consent" })).toHaveCount(0);
      await page.goto("/settings/team");
      await expect(page.getByRole("button", { name: "Send invitation" })).toHaveCount(0);

      await context.clearCookies();
      await seedPopulatedWorkspace(viewer);
      await useTenantSession(context, viewer);
      await page.goto("/contacts");
      await expect(page.getByRole("button", { name: "Suppress" })).toHaveCount(0);
      await page.goto("/settings/team");
      await expect(page.getByText("read-only team access", { exact: false })).toBeVisible();

      await context.clearCookies();
      const adminResources = await seedPopulatedWorkspace(admin);
      await functionalDb.update(schema.contacts).set({ optedIn: false, unsubscribedAt: new Date() }).where(and(eq(schema.contacts.organizationId, admin.organizationId), eq(schema.contacts.id, adminResources.contactId)));
      await useTenantSession(context, admin);
      await page.goto("/contacts?status=not_eligible");
      await expect(page.getByRole("button", { name: "Record new consent" }).first()).toBeVisible();
      await page.goto("/settings/team");
      await expect(page.getByRole("button", { name: "Send invitation" })).toBeVisible();
    } finally {
      await destroyTenant(member);
      await destroyTenant(viewer);
      await destroyTenant(admin);
    }
  });

  test("unverified account is denied sign-in and receives a verification email", async ({ page }) => {
    const account = await createUnverifiedAccount("sign-in-blocked");
    try {
      await page.goto("/sign-in");
      await page.getByLabel("Email").fill(account.email);
      await page.getByLabel("Password").fill(account.password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page).toHaveURL(/\/sign-in$/);
      await expect(page.getByText("Email not verified", { exact: true })).toBeVisible();
      expect(await capturedEmailUrl(account.email, "Verify your email address")).toContain("/api/auth/verify-email");
      await page.goto("/dashboard");
      await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
    } finally {
      await destroyUnverified(account.authUserId);
    }
  });
});
