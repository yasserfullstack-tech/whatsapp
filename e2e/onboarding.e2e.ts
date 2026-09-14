import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, expect, test, type Page } from "@playwright/test";
import { createDatabase, schema } from "../packages/db/src/index";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for onboarding E2E tests");
const database = createDatabase(databaseUrl);

async function capturedVerificationUrl(email: string) {
  const captureFile = process.env.AUTH_EMAIL_CAPTURE_FILE;
  if (!captureFile) throw new Error("AUTH_EMAIL_CAPTURE_FILE is required for browser E2E");

  let verificationUrl: string | undefined;
  await expect.poll(async () => {
    try {
      const content = await readFile(captureFile, "utf8");
      const messages = content.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { to?: string; subject?: string; text?: string });
      const message = messages.findLast((entry) => entry.to === email && entry.subject === "Verify your email address");
      verificationUrl = message?.text?.match(/https?:\/\/\S+/)?.[0];
      return Boolean(verificationUrl);
    } catch {
      return false;
    }
  }, { timeout: 10_000 }).toBe(true);

  if (!verificationUrl) throw new Error(`Verification email was not captured for ${email}`);
  return verificationUrl;
}

async function createVerifiedWorkspace(page: Page, label: string) {
  const suffix = `${label}-${Date.now()}-${randomUUID().slice(0, 8)}`.toLowerCase().replace(/[^a-z0-9-]/g, "");
  const email = `onboarding-${suffix}@example.com`;
  const password = "Onboarding-password-123!";

  await page.goto("/sign-up");
  await page.getByLabel("Name").fill(`Onboarding ${label}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/verify-email\?email=/);

  await page.goto(await capturedVerificationUrl(email));
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  return { email };
}

async function organizationForEmail(email: string): Promise<string> {
  const rows = await database.client`
    SELECT om.organization_id AS "organizationId"
    FROM users u
    INNER JOIN organization_members om ON om.user_id = u.id
    WHERE u.email = ${email}
    LIMIT 1
  ` as unknown as Array<{ organizationId: string }>;
  const organizationId = rows[0]?.organizationId;
  if (!organizationId) throw new Error(`Could not find workspace for ${email}`);
  return organizationId;
}

afterAll(async () => {
  await database.client.end({ timeout: 5 });
});

test("new users can leave, resume, skip optional work, and use Arabic onboarding", async ({ page }, testInfo) => {
  await createVerifiedWorkspace(page, testInfo.project.name);

  await expect(page.getByRole("heading", { name: "Setup progress" })).toBeVisible();
  await page.getByRole("link", { name: "Open setup guide" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("heading", { name: "Set up your workspace" })).toBeVisible();
  await expect(page.locator('[data-step="whatsapp"]')).toContainText("Incomplete");
  await expect(page.locator('[data-step="consent"]')).toContainText("Incomplete");

  await page.locator('input[name="consent"]').check();
  await page.getByRole("button", { name: "Confirm consent requirements" }).click();
  await expect(page.locator('[data-step="consent"]')).toContainText("Completed");

  await page.locator('[data-step="workspace"]').getByRole("button", { name: "Skip step" }).click();
  await expect(page.locator('[data-step="workspace"]')).toContainText("Skipped");
  await page.reload();
  await expect(page.locator('[data-step="workspace"]')).toContainText("Skipped");

  await page.getByRole("button", { name: "Skip onboarding" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Setup progress" })).toHaveCount(0);

  await page.goto("/onboarding");
  await expect(page.getByRole("button", { name: "Resume onboarding" })).toBeVisible();
  await page.getByRole("button", { name: "Resume onboarding" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "العربية" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "إعداد مساحة العمل" })).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "onboarding must not overflow horizontally").toBeLessThanOrEqual(1);
});

test("onboarding automatically recognizes work completed outside the guide", async ({ page }, testInfo) => {
  const { email } = await createVerifiedWorkspace(page, `existing-${testInfo.project.name}`);
  const organizationId = await organizationForEmail(email);
  const suffix = randomUUID().replaceAll("-", "");
  const wabaId = `waba-${suffix}`;

  await database.db.insert(schema.workspacePreferences).values({
    organizationId,
    timezone: "Asia/Baghdad",
    defaultCountry: "IQ",
    preferredLanguage: "en",
  });
  await database.db.insert(schema.whatsappPhoneNumbers).values({
    organizationId,
    wabaId,
    phoneNumberId: `phone-${suffix}`,
    displayPhoneNumber: "+9647700000000",
    verifiedName: "Existing Business",
    status: "connected",
    credentialKey: `e2e/${organizationId}/${suffix}`,
  });
  await database.db.insert(schema.contacts).values({
    organizationId,
    phoneE164: `+1555${Math.floor(Math.random() * 10_000_000).toString().padStart(7, "0")}`,
    displayName: "Existing Contact",
    optedIn: true,
    optInSource: "e2e",
    optInAt: new Date(),
  });
  await database.db.insert(schema.templates).values({
    organizationId,
    wabaId,
    metaTemplateId: `template-${suffix}`,
    name: `existing_${suffix.slice(0, 12)}`,
    language: "en",
    category: "marketing",
    status: "approved",
    bodyPreview: "Hello",
    components: [{ type: "BODY", text: "Hello" }],
  });
  await database.db.insert(schema.contactLists).values({
    organizationId,
    name: `Existing audience ${suffix.slice(0, 8)}`,
  });

  await page.goto("/onboarding");
  for (const step of ["workspace", "whatsapp", "contacts", "template", "audience"]) {
    await expect(page.locator(`[data-step="${step}"]`)).toContainText("Completed");
  }
  await expect(page.locator('[data-step="consent"]')).toContainText("Incomplete");
  await expect(page.locator('[data-step="campaign"]')).toContainText("Incomplete");
});

test("onboarding state is isolated between organizations", async ({ browser }, testInfo) => {
  const contextA = await browser.newContext({ baseURL: "http://127.0.0.1:3000" });
  const contextB = await browser.newContext({ baseURL: "http://127.0.0.1:3000" });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    const accountA = await createVerifiedWorkspace(pageA, `tenant-a-${testInfo.project.name}`);
    const accountB = await createVerifiedWorkspace(pageB, `tenant-b-${testInfo.project.name}`);
    const organizationB = await organizationForEmail(accountB.email);
    const now = new Date();

    await database.db.insert(schema.organizationOnboarding).values({
      organizationId: organizationB,
      consentConfirmedAt: now,
      completedAt: now,
      updatedAt: now,
    });

    await pageA.goto("/onboarding");
    await expect(pageA.locator('[data-step="consent"]')).toContainText("Incomplete");
    await expect(pageA.getByText("Onboarding is complete.", { exact: false })).toHaveCount(0);

    await pageB.goto("/onboarding");
    await expect(pageB.getByText("Onboarding is complete.", { exact: false })).toBeVisible();
    expect(await organizationForEmail(accountA.email)).not.toBe(organizationB);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
