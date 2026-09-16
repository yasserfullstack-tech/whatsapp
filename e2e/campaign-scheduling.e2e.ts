import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { schema } from "../packages/db/src/index";
import {
  formatDateTimeLocalInZone,
} from "../apps/web/lib/campaign-scheduling";
import {
  createTenant,
  destroyTenant,
  functionalDb,
  seedPopulatedWorkspace,
  useTenantSession,
} from "./support/functional-helpers";
import { guardBrowser } from "./support/browser-guard";

function desktopOnly(projectName: string) {
  return projectName !== "desktop-1440";
}

test.describe("campaign scheduling", () => {
  test.beforeEach(({}, testInfo) => test.skip(desktopOnly(testInfo.project.name), "campaign scheduling runs once on desktop Chromium"));

  test("create, reschedule, and cancel stay send-free before dispatch", async ({ page, context }) => {
    const tenant = await createTenant("campaign-scheduling");
    try {
      const seeded = await seedPopulatedWorkspace(tenant);
      await functionalDb.update(schema.templates)
        .set({ bodyPreview: "Hello from scheduled E2E" })
        .where(eq(schema.templates.id, seeded.templateId));
      await functionalDb.update(schema.workspacePreferences)
        .set({ timezone: "Asia/Baghdad", updatedAt: new Date() })
        .where(eq(schema.workspacePreferences.organizationId, tenant.organizationId));

      await useTenantSession(context, tenant);
      const health = await guardBrowser(page);
      await tenant.api.post("http://127.0.0.1:4777/__e2e/reset");

      await page.goto("/campaigns");
      const campaignName = `Scheduled browser campaign ${Date.now()}`;
      await page.getByLabel("Campaign name").fill(campaignName);
      await page.getByLabel("Delivery timing").selectOption("scheduled");

      const firstInstant = new Date(Date.now() + 60 * 60_000);
      await page.getByLabel("Schedule time").fill(formatDateTimeLocalInZone(firstInstant, "Asia/Baghdad"));

      const createResponsePromise = page.waitForResponse((response) =>
        response.url().endsWith("/api/campaigns") && response.request().method() === "POST",
      );
      await page.getByRole("button", { name: /schedule for .* contacts/i }).click();
      const createResponse = await createResponsePromise;
      expect(createResponse.status()).toBe(201);
      const created = await createResponse.json() as {
        campaignId: string;
        status: string;
        scheduledAt: string;
        snapshotTiming: string;
      };
      expect(created.status).toBe("scheduled");
      expect(created.snapshotTiming).toBe("dispatch");
      expect(new Date(created.scheduledAt).getTime()).toBeGreaterThan(Date.now());
      await expect(page.getByText(/campaign scheduled for/i)).toBeVisible();

      let [campaign] = await functionalDb.select({
        status: schema.campaigns.status,
        scheduledAt: schema.campaigns.scheduledAt,
        snapshotCreatedAt: schema.campaigns.snapshotCreatedAt,
      }).from(schema.campaigns).where(and(
        eq(schema.campaigns.id, created.campaignId),
        eq(schema.campaigns.organizationId, tenant.organizationId),
      )).limit(1);
      expect(campaign?.status).toBe("scheduled");
      expect(campaign?.snapshotCreatedAt).toBeNull();

      let recipients = await functionalDb.select({ id: schema.campaignRecipients.id })
        .from(schema.campaignRecipients)
        .where(eq(schema.campaignRecipients.campaignId, created.campaignId));
      expect(recipients).toHaveLength(0);
      let fakeMessages = await tenant.api.get("http://127.0.0.1:4777/__e2e/messages");
      expect((await fakeMessages.json() as { messages: unknown[] }).messages).toHaveLength(0);

      await page.goto(`/campaigns/${created.campaignId}`);
      await expect(page.getByRole("heading", { name: "scheduled" })).toBeVisible();
      await expect(page.getByText(/Asia\/Baghdad/)).toBeVisible();

      const secondInstant = new Date(Date.now() + 2 * 60 * 60_000);
      await page.getByLabel("Schedule time").fill(formatDateTimeLocalInZone(secondInstant, "Asia/Baghdad"));
      const rescheduleResponsePromise = page.waitForResponse((response) =>
        response.url().endsWith(`/api/campaigns/${created.campaignId}/control`) && response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Reschedule" }).click();
      const rescheduleResponse = await rescheduleResponsePromise;
      expect(rescheduleResponse.status()).toBe(200);
      const rescheduled = await rescheduleResponse.json() as { status: string; scheduledAt: string };
      expect(rescheduled.status).toBe("scheduled");
      expect(new Date(rescheduled.scheduledAt).getTime()).toBeGreaterThan(new Date(created.scheduledAt).getTime());
      await expect(page.getByText(/campaign rescheduled/i)).toBeVisible();

      [campaign] = await functionalDb.select({
        status: schema.campaigns.status,
        scheduledAt: schema.campaigns.scheduledAt,
        snapshotCreatedAt: schema.campaigns.snapshotCreatedAt,
      }).from(schema.campaigns).where(eq(schema.campaigns.id, created.campaignId)).limit(1);
      expect(campaign?.status).toBe("scheduled");
      expect(campaign?.snapshotCreatedAt).toBeNull();
      expect(campaign?.scheduledAt?.toISOString()).toBe(rescheduled.scheduledAt);

      page.once("dialog", (dialog) => void dialog.accept());
      const cancelResponsePromise = page.waitForResponse((response) =>
        response.url().endsWith(`/api/campaigns/${created.campaignId}/control`) && response.request().method() === "POST",
      );
      await page.getByRole("button", { name: /cancel campaign/i }).click();
      const cancelResponse = await cancelResponsePromise;
      expect(cancelResponse.status()).toBe(200);
      expect((await cancelResponse.json() as { status: string }).status).toBe("cancelled");
      await expect(page.getByText(/cancelled/i).first()).toBeVisible();

      [campaign] = await functionalDb.select({
        status: schema.campaigns.status,
        scheduledAt: schema.campaigns.scheduledAt,
        snapshotCreatedAt: schema.campaigns.snapshotCreatedAt,
      }).from(schema.campaigns).where(eq(schema.campaigns.id, created.campaignId)).limit(1);
      expect(campaign?.status).toBe("cancelled");
      expect(campaign?.snapshotCreatedAt).toBeNull();
      recipients = await functionalDb.select({ id: schema.campaignRecipients.id })
        .from(schema.campaignRecipients)
        .where(eq(schema.campaignRecipients.campaignId, created.campaignId));
      expect(recipients).toHaveLength(0);
      fakeMessages = await tenant.api.get("http://127.0.0.1:4777/__e2e/messages");
      expect((await fakeMessages.json() as { messages: unknown[] }).messages).toHaveLength(0);
      await health.expectHealthy();
    } finally {
      await destroyTenant(tenant);
    }
  });
});
