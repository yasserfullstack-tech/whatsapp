import { expect, test, type Page } from "@playwright/test";

const englishPages = [
  ["/contacts", "Consent and suppression"],
  ["/audiences", "Lists and reusable segments"],
  ["/templates", "Message templates"],
  ["/campaigns", "Launch a WhatsApp campaign"],
] as const;

const arabicPages = [
  ["/contacts", "الموافقة والحظر"],
  ["/audiences", "القوائم والشرائح القابلة لإعادة الاستخدام"],
  ["/templates", "قوالب الرسائل"],
  ["/campaigns", "إطلاق حملة واتساب"],
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

test("English and Arabic UI remains usable across responsive viewports", async ({ page }, testInfo) => {
  const suffix = `${testInfo.project.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`.toLowerCase().replace(/[^a-z0-9-]/g, "");
  const email = `e2e-${suffix}@example.com`;

  await page.goto("/sign-up");
  await expectDirection(page, "en", "ltr");
  await expect(page.getByRole("heading", { name: "Create your workspace" })).toBeVisible();
  await page.getByLabel("Name").fill(`E2E ${testInfo.project.name}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("E2e-password-123!");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  for (const [path, heading] of englishPages) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expectDirection(page, "en", "ltr");
    await expectNoHorizontalOverflow(page);
  }

  await page.getByRole("button", { name: "العربية" }).click();
  await expectDirection(page, "ar", "rtl");
  await expect(page.getByRole("heading", { name: "إطلاق حملة واتساب" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "التنقل الرئيسي" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  for (const [path, heading] of arabicPages) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
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
