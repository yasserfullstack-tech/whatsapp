import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
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

test.describe("product workflows", () => {
  test.beforeEach(({}, testInfo) => test.skip(desktopOnly(testInfo.project.name), "deep product workflows run once on desktop Chromium"));

  test("contact import crosses object storage and worker, then search/filter/suppress/resubscribe persist", async ({ page, context }) => {
    const tenant = await createTenant("contacts-workflow");
    try {
      await useTenantSession(context, tenant);
      const health = await guardBrowser(page);
      await page.goto("/dashboard#contacts");

      const csv = "phone,name\n+14155552671,Imported E2E Contact\n+14155552672,Second Imported Contact\n";
      await page.locator('input[type="file"]').setInputFiles({ name: "contacts-e2e.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
      const country = page.getByLabel("Country");
      if (await country.count()) await country.fill("US");
      await page.locator(".confirmationRow input[type=checkbox]").check();

      const presignPromise = page.waitForResponse((response) => response.url().endsWith("/api/contact-imports/presign") && response.request().method() === "POST");
      const uploadPromise = page.waitForResponse((response) => response.url().startsWith("http://127.0.0.1:4569/") && response.request().method() === "PUT");
      const queuePromise = page.waitForResponse((response) => /^\/api\/contact-imports\/[0-9a-f-]{36}$/i.test(new URL(response.url()).pathname) && response.request().method() === "POST");
      await page.getByRole("button", { name: /upload.*import/i }).click();

      const presignResponse = await presignPromise;
      if (!presignResponse.ok()) throw new Error(`presign failed (${presignResponse.status()}): ${await presignResponse.text()}`);
      const uploadResponse = await uploadPromise;
      expect(uploadResponse.ok(), `fake storage upload failed with HTTP ${uploadResponse.status()}`).toBeTruthy();
      const queueResponse = await queuePromise;
      if (!queueResponse.ok()) throw new Error(`queue import failed (${queueResponse.status()}): ${await queueResponse.text()}`);
      const queued = await queueResponse.json() as { id: string; status: string };
      expect(queued.id).toBeTruthy();

      let completedImport: { status: string; importedRows: number } | undefined;
      await expect.poll(async () => {
        const response = await tenant.api.get(`/api/contact-imports/${queued.id}`);
        if (!response.ok()) return `http-${response.status()}`;
        completedImport = await response.json() as { status: string; importedRows: number };
        return completedImport.status;
      }, { timeout: 30_000, intervals: [500, 1000, 1500] }).toBe("completed");
      expect(completedImport?.importedRows).toBe(2);

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
      const resubscribePromise = page.waitForResponse((response) => /\/api\/contacts\/[^/]+\/resubscribe$/.test(new URL(response.url()).pathname) && response.request().method() === "POST");
      await page.getByRole("button", { name: "Restore marketing eligibility" }).click();
      const resubscribeResponse = await resubscribePromise;
      expect(resubscribeResponse.ok(), `resubscribe failed with HTTP ${resubscribeResponse.status()}`).toBeTruthy();
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
      await expect.poll(async () => {
        const rows = await functionalDb.select({ phoneNumberId: schema.whatsappPhoneNumbers.phoneNumberId }).from(schema.whatsappPhoneNumbers).where(eq(schema.whatsappPhoneNumbers.organizationId, tenant.organizationId));
        return rows[0]?.phoneNumberId;
      }, { timeout: 15_000, intervals: [250, 500, 1000] }).toBe("e2e-phone");
      await page.reload();
      const connectedRow = page.locator(".settingsPhoneRow").filter({ hasText: "E2E WhatsApp" }).first();
      await expect(connectedRow).toContainText("E2E WhatsApp");
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
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect.poll(async () => {
        const [organization] = await functionalDb.select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, owner.organizationId)).limit(1);
        return organization?.name;
      }).toBe("E2E Persisted Workspace");
      await page.reload();
      await expect(page.getByLabel("Organization name")).toHaveValue("E2E Persisted Workspace");
      await expect(page.getByLabel("Timezone")).toHaveValue("Asia/Baghdad");

      await page.goto("/settings/notifications");
      const optionalEmailToggle = page.locator('input[name^="email:"]:not(:disabled)').first();
      await expect(optionalEmailToggle).toBeChecked();
      const optionalEmailName = await optionalEmailToggle.getAttribute("name");
      const optionalType = optionalEmailName?.slice("email:".length);
      if (!optionalType) throw new Error("Expected an optional email notification preference");
      await optionalEmailToggle.uncheck();
      await expect(page.locator('input:disabled').first()).toBeDisabled();
      await page.getByRole("button", { name: "Save preferences" }).click();
      await expect.poll(async () => {
        const [preference] = await functionalDb.select({ emailEnabled: schema.notificationPreferences.emailEnabled }).from(schema.notificationPreferences).where(and(
          eq(schema.notificationPreferences.organizationId, owner.organizationId),
          eq(schema.notificationPreferences.userId, owner.appUserId),
          eq(schema.notificationPreferences.type, optionalType),
        )).limit(1);
        return preference?.emailEnabled;
      }).toBe(false);
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
      const exportDownloadPromise = page.waitForEvent("download");
      await exportRow.getByRole("button", { name: "Download" }).click();
      const exportDownload = await exportDownloadPromise;
      expect(exportDownload.suggestedFilename()).toMatch(/\.ndjson$/);
      const exportSavedPath = `/tmp/e2e-export-${randomUUID()}.ndjson`;
      await exportDownload.saveAs(exportSavedPath);
      const exportText = await readFile(exportSavedPath, "utf8");
      expect(exportText.endsWith("\n")).toBe(true);
      const exportRecords = exportText.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { type?: string; data?: unknown });
      expect(exportRecords[0]?.type).toBe("manifest");
      expect(exportRecords.some((record) => record.type === "contact")).toBe(true);

      const dangerBlocks = page.locator(".dangerBlock");
      const accountBlock = dangerBlocks.nth(1);
      const accountInput = accountBlock.locator("input");
      const accountConfirmation = (await accountBlock.locator("label span").first().textContent())?.trim();
      if (!accountConfirmation) throw new Error("Missing account confirmation text");
      await accountInput.fill(accountConfirmation);
      await accountBlock.locator('button[aria-haspopup="dialog"]').click();
      const confirmationDialog = page.locator("dialog.destructiveDialog");
      await expect(confirmationDialog).toBeVisible();
      await confirmationDialog.locator("button.dangerButton").click();
      await expect(page.getByRole("status")).toContainText(/workspace|owner|ownership/i);
      await confirmationDialog.locator("button.secondary").click();
      await expect(confirmationDialog).toBeHidden();

      const workspaceBlock = dangerBlocks.first();
      await workspaceBlock.locator("input").first().fill(owner.organizationSlug);
      await workspaceBlock.locator('input[type="checkbox"]').check();
      await workspaceBlock.locator("button.dangerButton").click();
      await expect(page.getByRole("status")).toContainText(/scheduled/i);
      await workspaceBlock.locator("button").filter({ hasText: /cancel/i }).click();
      await expect(page.getByRole("status")).toContainText(/cancelled/i);

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
      await expect.poll(async () => {
        const [membership] = await functionalDb.select({ role: schema.organizationMembers.role }).from(schema.organizationMembers).where(and(
          eq(schema.organizationMembers.organizationId, owner.organizationId),
          eq(schema.organizationMembers.userId, invited.appUserId),
        )).limit(1);
        return membership?.role;
      }).toBe("member");
      await page.goto("/settings/general");
      await expect(page.getByLabel("Organization name")).toHaveValue("E2E Persisted Workspace");
      await health.expectHealthy();
    } finally {
      await destroyTenant(invited);
      await destroyTenant(owner);
    }
  });
});