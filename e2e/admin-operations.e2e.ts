import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { schema } from "../packages/db/src/index";
import { createContactImportQueue } from "../packages/queue/src/index";
import {
  createTenant,
  destroyTenant,
  functionalDb,
  grantPlatformAdmin,
  seedPopulatedWorkspace,
  useTenantSession,
} from "./support/functional-helpers";
import { guardBrowser } from "./support/browser-guard";

/**
 * PR-020 evidence: the platform-admin operational views are usable in a real
 * browser, list filters/pagination work, and the guarded retries recover failed
 * work without direct database edits. Impersonation is intentionally absent.
 */

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

test.describe("platform admin operational views", () => {
  test.beforeEach(({}, testInfo) => test.skip(desktopOnly(testInfo.project.name), "admin operations run once on desktop Chromium"));

  test("operational views, filters, and safe retries work end to end", async ({ page, context }) => {
    const admin = await createTenant("ops-admin");
    const victim = await createTenant("ops-victim");
    const contactImportQueue = createContactImportQueue(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
    try {
      await grantPlatformAdmin(admin);
      const seeded = await seedPopulatedWorkspace(victim);
      await useTenantSession(context, admin);
      const health = await guardBrowser(page);

      // Meta connection health: the seeded number is visible and searchable.
      await page.goto(`/admin/connections?q=${encodeURIComponent(seeded.phoneNumberId)}`);
      await expect(page.locator("tr").filter({ hasText: seeded.phoneNumberId })).toHaveCount(1);
      await page.getByRole("button", { name: "Apply" }).click();
      await expect(page.locator("tr").filter({ hasText: seeded.phoneNumberId })).toHaveCount(1);

      // Billing visibility: the workspace subscription is listed for its owner.
      await page.goto(`/admin/billing?q=${encodeURIComponent(victim.organizationSlug)}`);
      await expect(page.locator("tr").filter({ hasText: victim.organizationSlug })).toHaveCount(1);

      // Webhook operations: durable inbox filters and safe replay.
      const eventKey = `e2e-webhook-${randomUUID().slice(0, 8)}`;
      const [event] = await functionalDb.insert(schema.webhookEvents).values({
        organizationId: victim.organizationId,
        eventKey,
        phoneNumberId: seeded.phoneNumberId,
        payload: { object: "whatsapp_business_account", entry: [] },
        processingStatus: "failed",
        processingAttempts: 2,
        lastProcessingError: "e2e forced webhook failure",
      }).returning();
      await page.goto(`/admin/webhooks?q=${encodeURIComponent(eventKey)}`);
      await expect(page.locator("tr").filter({ hasText: eventKey })).toHaveCount(1);
      await page.getByRole("link", { name: "Inspect" }).first().click();
      await expect(page.getByText("e2e forced webhook failure").first()).toBeVisible();
      await submitServerAction(page, "/admin/webhooks", () => page.getByRole("button", { name: "Retry event safely" }).click());
      await expect
        .poll(async () => (await functionalDb.select({ status: schema.webhookEvents.processingStatus }).from(schema.webhookEvents).where(eq(schema.webhookEvents.id, event.id)))[0]?.status)
        .toBe("processed");

      // Queue operations: a genuinely failed import job is retried from the UI.
      await contactImportQueue.clean(0, 10_000, "failed");
      const jobId = `e2e-ops-retry-${randomUUID().slice(0, 8)}`;
      const job = await contactImportQueue.add(
        "import-csv",
        { organizationId: victim.organizationId, importId: randomUUID() },
        { jobId, attempts: 1 },
      );
      await expect
        .poll(async () => job.getState(), { timeout: 20_000, message: "the worker should exhaust the single attempt" })
        .toBe("failed");

      await page.goto("/admin/system");
      const failedRow = page.locator("tr").filter({ hasText: jobId }).first();
      await expect(failedRow).toBeVisible();
      await submitServerAction(page, "/admin/system", () => failedRow.getByRole("button", { name: "Retry failed job" }).click());

      // The retry is recorded in the platform audit trail.
      await page.goto(`/admin/audit?q=${encodeURIComponent(`contact-import:${jobId}`)}`);
      await expect(page.getByRole("cell", { name: "queue.retry_requested" }).first()).toBeVisible();

      // Audit export is downloadable from the browser session.
      const exportResponse = await page.request.get("/admin/audit/export?action=queue.retry_requested");
      expect(exportResponse.status()).toBe(200);
      expect(exportResponse.headers()["content-type"] ?? "").toContain("text/csv");
      expect(await exportResponse.text()).toContain('"queue.retry_requested"');

      // Pagination copy is rendered on the operational lists.
      await page.goto("/admin/users");
      await expect(page.getByText(/Page 1 of \d+/)).toBeVisible();

      await health.expectHealthy();
    } finally {
      await contactImportQueue.close();
      await destroyTenant(victim);
      await destroyTenant(admin);
    }
  });
});
