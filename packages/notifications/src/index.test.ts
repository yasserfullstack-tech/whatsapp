import { describe, expect, test } from "bun:test";
import { renderNotificationEmail, resolveNotificationChannels } from "./index";

describe("notification policy", () => {
  test("respects preferences for non-critical notifications", () => {
    expect(resolveNotificationChannels("campaign_completed", { inAppEnabled: true, emailEnabled: false })).toEqual({ inApp: true, email: false });
  });

  test("mandatory security notifications cannot be disabled", () => {
    expect(resolveNotificationChannels("security_event", { inAppEnabled: false, emailEnabled: false })).toEqual({ inApp: true, email: true });
  });

  test("renders English email as LTR", () => {
    const rendered = renderNotificationEmail({ title: "Campaign completed", message: "Done", link: "/campaigns/123", locale: "en", baseUrl: "https://app.example.test" });
    expect(rendered.direction).toBe("ltr");
    expect(rendered.html).toContain('lang="en" dir="ltr"');
    expect(rendered.html).toContain("https://app.example.test/campaigns/123");
  });

  test("renders Arabic email as RTL", () => {
    const rendered = renderNotificationEmail({ title: "اكتملت الحملة", message: "تم الإرسال", locale: "ar" });
    expect(rendered.direction).toBe("rtl");
    expect(rendered.html).toContain('lang="ar" dir="rtl"');
  });
});
