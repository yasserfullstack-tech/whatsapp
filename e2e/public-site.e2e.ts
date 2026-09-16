import { expect, test, type Page } from "@playwright/test";

const englishPages = [
  ["/features", "Features for repeatable WhatsApp campaign operations"],
  ["/pricing", "Pricing that can grow with usage"],
  ["/whatsapp", "Connect the customer's own Meta business assets"],
  ["/security", "Security claims should match the controls that actually exist"],
  ["/contact", "Talk to the team"],
  ["/privacy", "Privacy Policy"],
  ["/terms", "Terms of Service"],
  ["/acceptable-use", "Acceptable Use Policy"],
  ["/anti-spam", "Anti-Spam Policy"],
] as const;

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "public page must not overflow horizontally").toBeLessThanOrEqual(1);
}

async function expectDirection(page: Page, lang: "en" | "ar", dir: "ltr" | "rtl") {
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
  await expect(page.locator("html")).toHaveAttribute("dir", dir);
}

test("public site is bilingual and responsive", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/");

  await expectDirection(page, "en", "ltr");
  await expect(page.getByRole("heading", { name: /Run high-volume WhatsApp campaigns/ })).toBeVisible();
  await expect(page.locator(".mkt-scale-note")).toContainText("500,000 recipients");
  await expectNoHorizontalOverflow(page);

  for (const [path, heading] of englishPages) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expectDirection(page, "en", "ltr");
    await expectNoHorizontalOverflow(page);
  }

  await page.goto("/security");
  await expect(page.getByText(/We do not claim SOC 2, ISO 27001/)).toBeVisible();

  await page.getByRole("button", { name: "العربية" }).click();
  await expectDirection(page, "ar", "rtl");
  await expect(page.getByRole("heading", { name: "ادعاءات الأمان يجب أن تطابق الضوابط الموجودة فعلاً" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: /أدِر حملات واتساب كبيرة/ })).toBeVisible();
  await expectDirection(page, "ar", "rtl");
  await expectNoHorizontalOverflow(page);

  // Legal body copy stays in English until a counsel-reviewed Arabic translation is approved.
  await page.goto("/anti-spam");
  await expect(page.getByRole("heading", { name: "Anti-Spam Policy" })).toBeVisible();
  await expect(page.getByText(/legally operative draft is currently maintained in English/)).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "EN" }).click();
  await expectDirection(page, "en", "ltr");
});
