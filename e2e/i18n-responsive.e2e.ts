import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

const englishPages = [
  ["/contacts", "Consent and suppression"],
  ["/audiences", "Lists and reusable segments"],
  ["/templates", "Message templates"],
  ["/campaigns", "Launch a WhatsApp campaign"],
  ["/reports", "Reports & analytics"],
  ["/reports/campaigns", "Campaign reports"],
  ["/reports/templates", "Template reports"],
  ["/reports/audiences", "Audience reports"],
  ["/reports/phone-numbers", "Phone number reports"],
  ["/settings/billing", "Billing"],
  ["/settings/data", "Data"],
] as const;

const arabicPages = [
  ["/contacts", "الموافقة والحظر"],
  ["/audiences", "القوائم والشرائح القابلة لإعادة الاستخدام"],
  ["/templates", "قوالب الرسائل"],
  ["/campaigns", "إطلاق حملة واتساب"],
  ["/reports", "التقارير والتحليلات"],
  ["/reports/campaigns", "تقارير الحملات"],
  ["/reports/templates", "تقارير القوالب"],
  ["/reports/audiences", "تقارير الجمهور"],
  ["/reports/phone-numbers", "تقارير أرقام الهاتف"],
  ["/settings/billing", "الفوترة"],
  ["/settings/data", "البيانات"],
] as const;

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }))).toEqual(expect.objectContaining({ width: expect.any(Number), scroll: expect.any(Number) }));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "document must not overflow horizontally").toBeLessThanOrEqual(1);
}

async function expectDirection(page: Page, lang: "en" | "ar", dir: "ltr" | "rtl") {
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
  await expect(page.locator("html")).toHaveAttribute("dir", dir);
}

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

test("English and Arabic UI remains usable across responsive viewports", async ({ page }, testInfo) => {
  const suffix = `${testInfo.project.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`.toLowerCase().replace(/[^a-z0-9-]/g, "");
  const email = `e2e-${suffix}@example.com`;
  const password = "E2e-password-123!";

  await page.goto("/sign-up");
  await expectDirection(page, "en", "ltr");
  await expect(page.getByRole("heading", { name: "Create your workspace" })).toBeVisible();
  await page.getByLabel("Name").fill(`E2E ${testInfo.project.name}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/verify-email\?email=/);
  await expect(page.getByRole("heading", { name: "Verify your email" })).toBeVisible();

  const verificationUrl = await capturedVerificationUrl(email);
  await page.goto(verificationUrl);
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  for (const [path, heading] of englishPages) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, level: 1, exact: true })).toBeVisible();
    await expectDirection(page, "en", "ltr");
    await expectNoHorizontalOverflow(page);
  }

  await page.goto("/settings/data");
  await expect(page.getByRole("button", { name: "Schedule deletion" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Delete account permanently" })).toBeDisabled();

  await page.getByRole("button", { name: "العربية" }).click();
  await expectDirection(page, "ar", "rtl");
  await expect(page.getByRole("heading", { name: "البيانات", level: 1, exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "التنقل الرئيسي" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  for (const [path, heading] of arabicPages) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, level: 1, exact: true })).toBeVisible();
    await expectDirection(page, "ar", "rtl");
    await expectNoHorizontalOverflow(page);
  }

  await page.goto("/dashboard");
  await expect(page.getByText("نظرة عامة", { exact: true }).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "EN" }).click();
  await expectDirection(page, "en", "ltr");
  await expect(page.getByText("Overview", { exact: true }).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
