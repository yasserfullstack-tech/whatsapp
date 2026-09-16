import { describe, expect, test } from "bun:test";
import { mapStripeSubscriptionStatus } from "./stripe-sync";

describe("Stripe subscription lifecycle projection", () => {
  const now = new Date("2026-09-16T10:00:00.000Z");

  test("maps successful subscription states", () => {
    expect(mapStripeSubscriptionStatus("trialing", now, 7).status).toBe("trialing");
    expect(mapStripeSubscriptionStatus("active", now, 7).status).toBe("active");
  });

  test("puts past-due subscriptions in a bounded grace period", () => {
    const mapped = mapStripeSubscriptionStatus("past_due", now, 7);
    expect(mapped.status).toBe("grace_period");
    expect(mapped.graceEndsAt?.toISOString()).toBe("2026-09-23T10:00:00.000Z");

    const existing = new Date("2026-09-25T10:00:00.000Z");
    expect(mapStripeSubscriptionStatus("past_due", now, 7, existing).graceEndsAt).toEqual(existing);
  });

  test("suspends unpaid subscriptions and cancels terminal subscriptions", () => {
    expect(mapStripeSubscriptionStatus("unpaid", now, 7)).toMatchObject({ status: "suspended", suspendedAt: now });
    expect(mapStripeSubscriptionStatus("paused", now, 7)).toMatchObject({ status: "suspended", suspendedAt: now });
    expect(mapStripeSubscriptionStatus("canceled", now, 7)).toMatchObject({ status: "cancelled", cancelledAt: now });
    expect(mapStripeSubscriptionStatus("incomplete_expired", now, 7)).toMatchObject({ status: "cancelled", cancelledAt: now });
  });

  test("rejects unknown provider states instead of silently granting access", () => {
    expect(() => mapStripeSubscriptionStatus("mystery", now, 7)).toThrow("Unsupported Stripe subscription status");
  });
});
