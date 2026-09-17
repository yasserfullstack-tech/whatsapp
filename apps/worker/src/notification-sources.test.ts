import { describe, expect, test } from "bun:test";
import {
  isQualityDegraded,
  subscriptionNotificationType,
  templateNotificationType,
  usagePercent,
} from "./notification-sources";

describe("notification source mapping", () => {
  test("only emits quality degradation for worse known ratings", () => {
    expect(isQualityDegraded("GREEN", "YELLOW")).toBe(true);
    expect(isQualityDegraded("YELLOW", "RED")).toBe(true);
    expect(isQualityDegraded("RED", "YELLOW")).toBe(false);
    expect(isQualityDegraded(null, "RED")).toBe(false);
  });

  test("maps only supported template terminal states", () => {
    expect(templateNotificationType("approved")).toBe("template_approved");
    expect(templateNotificationType("REJECTED")).toBe("template_rejected");
    expect(templateNotificationType("paused")).toBeNull();
  });

  test("past-due subscription states stay mandatory", () => {
    expect(subscriptionNotificationType("past_due")).toBe("subscription_past_due");
    expect(subscriptionNotificationType("grace_period")).toBe("subscription_past_due");
    expect(subscriptionNotificationType("active")).toBe("subscription_changed");
  });

  test("usage thresholds use deterministic integer percentages", () => {
    expect(usagePercent(80, 100)).toBe(80);
    expect(usagePercent(799, 1000)).toBe(79);
    expect(usagePercent(5, null)).toBeNull();
    expect(usagePercent(5, 0)).toBeNull();
  });
});
