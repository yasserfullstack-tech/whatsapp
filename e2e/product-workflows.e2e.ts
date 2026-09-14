import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { schema } from "../packages/db/src/index";
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

async function capturedInvitationUrl(email: string) {
  const file = process.env.AUTH_EMAIL_CAPTURE_FILE;
  if (!file) throw new Error("AUTH_EMAIL_CAPTURE_FILE is required");
  let url: string | undefined;
  await expect.poll(async () => {
    try {
      const content = await readFile(file, "utf8");
      const messages = content.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { to?: string; subject?: string; text?: string });
      const message = messages.findLast((entry) => entry.to === email && entry.subject?.startsWith("Invitation to "));
      url = message?.text?.match(/https?:\/\/\S+/)?.[0];
      return Boolean(url);
    } catch {
      return false;
    }
  }, { timeout: 10_000 }).toBe(true);
  if (!url) throw new Error(`Invitation URL not captured for ${email}`);
  return url;
}

async function submitServerAction(page: import("@playwright/test").Page, route: string, click: () => Promise<void>) {
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === route,
  );
  await click();
  const response = await responsePromise;
  expect(response.ok(), `server action ${route} failed with ${response.status()}`).toBeTruthy();
}

test.describe("product workflows", () => {
  test.beforeEach(({}, testInfo) => test.skip(desktopOnly(testInfo.project.name), "deep product workflows run once on desktop Chromium"));

  test("contact import crosses object storage and worker, then search/filter/suppress/resubscribe persist", async ({ page, context }) => {
    const tenant = await createTenant("contacts-workflow");
    try {
      await useTenantSession(context, tenant);
      const health = await guardBrowser(page);
      await page.goto("/dashboard#contacts");

      const csv = "phone,name\n+15551234567,Imported E2E Contact\n+15557654321,Second Imported Contact\n";
      await page.locator('input[type="file"]').setInputFiles({ name: "contacts-e2e.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
      const country = page.getByLabel("Country");
      if (await country.count()) await country.fill("US");
      await page.locator(".confirmationRow input[type=checkbox]").check();
      await page.getByRole("button", { name: /upload.*import/i }).click();
      await expect.poll(async () => {
        const imports = await functionalDb.select().from(schema.contactImports).where(eq(schema.contactImports.organizationId, tenant.organizationId));
        const current = imports.find((row) => row.originalFileName === "contacts-e2e.csv");
        return current ? `${current.status}:${current.importedRows}` : "missing";
      }, { timeout: 30_000, intervals: [500, 1000, 1500] }).toBe("completed:2");

      await page.goto("/contacts");
      await page.locator('input[name="q"]').fill("Imported E2E");
      await page.getByRole("button", { name: /apply filters/i }).click();
      await expect(page.getByText("Imported E2E Contact", { exact: true })).toBeVisible();
      await expect(page.getByText("Second Imported Contact", { exact: true })).toHaveCount(0);

      let row = page.locator(".contactRow").filter({ hasText: "Imported E2E Contact" });
      await row.getByRole("button", { name: "Suppress" }).click();
      await page.getByLabel("Reason").fill("E2E customer opt-out request");
      await page.getByRole("button", { name: "Suppress contact" }).click();
      row = page.locator(".contactRow").filter({ hasText: "Imported E2E Contact" });
      await expect(row).toContainText(/suppressed/i);

      await page.locator('select[name="status"]').selectOption("suppressed");
      await page.getByRole("button", { name: /apply filters/i }).click();
      row = page.locator(".contactRow").filter({ hasText: "Imported E2E Contact" });
      await expect(row).toBeVisible();
      await row.getByRole("button", { name: "Record new consent" }).click();
      await page.locator('input[name="consentSource"]').fill("E2E signed web form");
      await page.locator('textarea[name="evidenceNote"]').fill("E2E evidence reference 2026-09-14");
      await page.locator('input[name="confirmation"]').check();
      await page.getByRole("button", { name: "Restore eligibility" }).click();
      await expect(page.getByText(/restored/i)).toBeVisible();
      await page.goto("/contacts?q=Imported+E2E&status=eligible");
      await expect(page.getByText("Imported E2E Contact", { exact: true })).toBeVisible();
      await health.expectHealthy();
    } finally {
      await destroyTenant(tenant);
    }
  });

  test("audience preview/save and template sync/create use real APIs with fake Meta", async ({ page, context }) => {
    const tenant = await createTenant("audience-template");
    try {
      await seedPopulatedWorkspace(tenant);
      await useTenantSession(context, tenant);
      const health = await guardBrowser(page);

      await page.goto("/audiences");
      await page.getByLabel("Segment name").fill("Alpha E2E segment");
      const filterRow = page.locator(".filterBuilderRow").first();
      await filterRow.locator("select").first().selectOption("display_name");
      await filterRow.locator("input").fill("Alpha E2E");
      await page.getByRole("button", { name: "Preview audience" }).click();
      await expect(page.getByText("1 eligible contacts", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Save segment" }).click();
      await expect(page.getByText(/segment saved/i)).toBeVisible();
      await page.reload();
      await expect(page.getByText("Alpha E2E segment", { exact: false })).toBeVisible();

      await page.goto("/templates");
      await page.getByRole("button", { name: "Sync from Meta" }).click();
      await expect(page.getByText("e2e_synced_template", { exact: false })).toBeVisible();
      await page.getByLabel("Template name").fill(`created_${randomUUID().replaceAll("-", "").slice(0, 10)}`);
      await page.getByLabel(/^Body/).fill("Hello from browser E2E");
      await page.getByRole("button", { name: "Submit to Meta" }).click();
      await expect(page.getByText(/submitted.*PENDING/i)).toBeVisible();
      await health.expectHealthy();
    } finally {
      await destroyTenant(tenant);
    }
  });

  test("WhatsApp Embedded Signup completes through the fake SDK and fake Graph API", async ({ page, context }) => {
    const tenant = await createTenant("whatsapp-connect");
    try {
      await useTenantSession(context, tenant);
      const health = await guardBrowser(page);
      await page.goto("/settings/whatsapp");
      const connect = page.getByRole("button", { name: /connect whatsapp/i });
      await expect(connect).toBeEnabled();
      await connect.click();
      await expect(page.getByText(/connected/i).first()).toBeVisible({ timeout: 15_000 });
      await page.reload();
      await expect(page.getByText("E2E WhatsApp", { exact: false })).toBeVisible();
      const rows = await functionalDb.select().from(schema.whatsappPhoneNumbers).where(eq(schema.whatsappPhoneNumbers.organizationId, tenant.organizationId));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.phoneNumberId).toBe("e2e-phone");
      await health.expectHealthy();
    } finally {
      await destroyTenant(tenant);
    }
  });

  test("campaign launch reaches the worker/fake Meta; pause/resume/cancel and reports/export work", async ({ page, context }) => {
    const tenant = await createTenant("campaign-workflow");
    try {
      const seeded = await seedPopulatedWorkspace(tenant);
      await functionalDb.update(schema.templates).set({ bodyPreview: "Hello from E2E" }).where(eq(schema.templates.id, seeded.templateId));
      const [holdContact] = await functionalDb.select().from(schema.contacts).where(eq(schema.contacts.id, seeded.contactId)).limit(1);
      if (!holdContact) throw new Error("control contact was not seeded");
      await functionalDb.update(schema.campaigns).set({ status: "paused", recipientCount: 1, snapshotCreatedAt: new Date(), startedAt: new Date() }).where(eq(schema.campaigns.id, seeded.campaignId));
      await functionalDb.insert(schema.campaignRecipients).values({
        organizationId: tenant.organizationId,
        campaignId: seeded.campaignId,
        contactId: holdContact.id,
        phoneE164: holdContact.phoneE164,
        displayName: holdContact.displayName,
        status: "queued",
        queuedAt: new Date(),
      });

      await useTenantSession(context, tenant);
      const health = await guardBrowser(page);
      await tenant.api.post("http://127.0.0.1:4777/__e2e/reset");

      await page.goto("/campaigns");
      const campaignName = `Browser campaign ${Date.now()}`;
      await page.getByLabel("Campaign name").fill(campaignName);
      const createResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/campaigns") && response.request().method() === "POST");
      await page.getByRole("button", { name: /launch.*contacts/i }).click();
      const createResponse = await createResponsePromise;
      expect(createResponse.status()).toBe(201);
      const created = await createResponse.json() as { campaignId: string };
      expect(created.campaignId).toBeTruthy();

      await expect.poll(async () => {
        const response = await tenant.api.get(`/api/campaigns/${created.campaignId}`);
        const body = await response.json() as { status: string };
        return body.status;
      }, { timeout: 30_000, intervals: [500, 1000, 1500] }).toBe("completed");

      const fakeMessages = await tenant.api.get("http://127.0.0.1:4777/__e2e/messages");
      const fakeBody = await fakeMessages.json() as { messages: unknown[] };
      expect(fakeBody.messages).toHaveLength(2);

      await page.goto(`/campaigns/${seeded.campaignId}`);
      await page.getByRole("button", { name: /resume/i }).click();
      await expect(page.getByRole("heading", { name: /sending/i })).toBeVisible();
      await page.getByRole("button", { name: /pause/i }).click();
      await expect(page.getByRole("heading", { name: /paused/i })).toBeVisible();
      page.once("dialog", (dialog) => void dialog.accept());
      await page.getByRole("button", { name: /cancel/i }).click();
      await expect(page.getByText(/cancelled/i).first()).toBeVisible();

      await page.goto("/reports");
      await expect(page.getByRole("link", { name: campaignName, exact: true })).toBeVisible();
      await page.getByLabel("Date range").first().selectOption("today");
      await page.getByRole("button", { name: "Apply" }).click();
      await expect(page).toHaveURL(/range=today/);
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("link", { name: /export csv/i }).click();
      const reportDownload = await downloadPromise;
      expect(reportDownload.suggestedFilename()).toMatch(/\.csv$/);
      await health.expectHealthy();
    } finally {
      await destroyTenant(tenant);
    }
  });

  test("workspace settings, notification toggles/pagination, data lifecycle, and invitation persist", async ({ page, context }) => {
    const owner = await createTenant("settings-owner");
    const invited = await createTenant("settings-invited", "viewer");
    try {
      await seedPopulatedWorkspace(owner);
      await useTenantSession(context, owner);
      const health = await guardBrowser(page);

      await page.goto("/settings/general");
      await page.getByLabel("Organization name").fill("E2E Persisted Workspace");
      await page.getByLabel("Timezone").fill("Asia/Baghdad");
      await page.getByLabel("Default country").fill("IQ");
      await page.getByLabel("Preferred language").selectOption("en");
      await submitServerAction(page, "/settings/general", () => page.getByRole("button", { name: "Save changes" }).click());
      await page.reload();
      await expect(page.getByLabel("Organization name")).toHaveValue("E2E Persisted Workspace");
      await expect(page.getByLabel("Timezone")).toHaveValue("Asia/Baghdad");

      await page.goto("/settings/notifications");
      const optionalEmailToggle = page.locator('input[name^="email:"]:not(:disabled)').first();
      await expect(optionalEmailToggle).toBeChecked();
      await optionalEmailToggle.uncheck();
      await expect(page.locator('input:disabled').first()).toBeDisabled();
      await submitServerAction(page, "/settings/notifications", () => page.getByRole("button", { name: "Save preferences" }).click());
      await page.reload();
      await expect(page.locator('input[name^="email:"]:not(:disabled)').first()).not.toBeChecked();

      const notificationBaseTime = Date.now();
      const notifications = await functionalDb.insert(schema.notifications).values(Array.from({ length: 21 }, (_, index) => ({
        organizationId: owner.organizationId,
        userId: owner.appUserId,
        type: "campaign_completed",
        title: `E2E notification ${index + 1}`,
        message: `Notification pagination row ${index + 1}`,
        dedupeKey: `e2e-${randomUUID()}-${index}`,
        link: "/campaigns",
        createdAt: new Date(notificationBaseTime + index * 1_000),
      }))).returning({ id: schema.notifications.id });
      await functionalDb.insert(schema.notificationDeliveries).values(notifications.map((notification) => ({
        notificationId: notification.id,
        organizationId: owner.organizationId,
        userId: owner.appUserId,
        channel: "in_app" as const,
        status: "sent" as const,
        sentAt: new Date(),
      })));
      await page.goto("/notifications");
      await expect(page.getByText("E2E notification 21")).toBeVisible();
      await page.getByRole("link", { name: /next/i }).click();
      await expect(page).toHaveURL(/page=2/);
      await expect(page.getByText("E2E notification 1")).toBeVisible();
      await page.goto("/notifications");
      await page.getByRole("button", { name: "Mark all read" }).click();
      await expect(page.getByText("Read", { exact: true }).first()).toBeVisible();

      await page.goto("/settings/data");
      const rawWebhookDays = page.getByLabel("Raw webhook days");
      await rawWebhookDays.fill("31");
      await page.getByRole("button", { name: "Save retention" }).click();
      await expect(page.getByRole("status")).toContainText("Retention policy saved");
      await page.reload();
      await expect(page.getByLabel("Raw webhook days")).toHaveValue("31");

      await page.getByRole("button", { name: "Export contacts" }).click();
      const exportRow = page.locator(".settingsListRow").filter({ hasText: "contacts" }).first();
      await expect(exportRow).toContainText("completed", { timeout: 35_000 });
      const signedDownloadPromise = page.waitForResponse((response) => response.url().includes("/api/settings/data/export/") && response.url().endsWith("/download"));
      await exportRow.getByRole("button", { name: "Download" }).click();
      const signedDownloadResponse = await signedDownloadPromise;
      expect(signedDownloadResponse.ok()).toBeTruthy();
      const signedDownload = await signedDownloadResponse.json() as { url: string };
      expect(signedDownload.url).toMatch(/^http:\/\/127\.0\.0\.1:4569\//);
      const exportedObject = await owner.api.get(signedDownload.url);
      expect(exportedObject.ok()).toBeTruthy();
      expect(await exportedObject.text()).toMatch(/phone|contact/i);
      await page.goto("/settings/data");

      await page.getByPlaceholder("DELETE ACCOUNT").fill("DELETE ACCOUNT");
      await page.getByRole("button", { name: "Delete account permanently" }).click();
      await expect(page.getByRole("status")).toContainText(/workspace|owner|ownership/i);

      await page.getByPlaceholder(owner.organizationSlug).fill(owner.organizationSlug);
      await page.locator(".destructiveCheck input[type=checkbox]").check();
      await page.getByRole("button", { name: "Schedule deletion" }).click();
      await expect(page.getByRole("status")).toContainText("Workspace deletion scheduled");
      await page.getByRole("button", { name: "Cancel deletion request" }).click();
      await expect(page.getByRole("status")).toContainText("Deletion request cancelled");

      await page.goto("/settings/team");
      await page.getByLabel("Email").fill(invited.email);
      await page.getByLabel("Role").selectOption("member");
      await page.getByRole("button", { name: "Send invitation" }).click();
      await expect(page.getByText(invited.email)).toBeVisible();
      const inviteUrl = await capturedInvitationUrl(invited.email);

      await context.clearCookies();
      await useTenantSession(context, invited);
      await page.goto(inviteUrl);
      await page.getByRole("button", { name: "Accept invitation" }).click();
      await expect(page).toHaveURL(/\/settings\/team$/);
      await page.goto("/settings/general");
      await expect(page.getByLabel("Organization name")).toHaveValue("E2E Persisted Workspace");
      await health.expectHealthy();
    } finally {
      await destroyTenant(invited);
      await destroyTenant(owner);
    }
  });
});
