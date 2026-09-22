import { describe, expect, test } from "bun:test";
import {
  ONBOARDING_TEST_RECIPIENT_LIMIT,
  isSuccessfulOnboardingTest,
  validateOnboardingTestRequest,
} from "./onboarding-test-mode";

describe("onboarding test mode", () => {
  test("rejects direct requests above the recipient limit", () => {
    expect(validateOnboardingTestRequest({
      eligibleContacts: ONBOARDING_TEST_RECIPIENT_LIMIT + 1,
      scheduledAt: null,
    })).toBe(`Onboarding test campaigns are limited to ${ONBOARDING_TEST_RECIPIENT_LIMIT} eligible contacts`);
  });

  test("rejects scheduled onboarding tests", () => {
    expect(validateOnboardingTestRequest({
      eligibleContacts: 1,
      scheduledAt: new Date("2026-09-18T10:00:00Z"),
    })).toBe("Onboarding test messages must be sent immediately");
  });

  test("requires every snapshotted recipient to be accepted successfully", () => {
    expect(isSuccessfulOnboardingTest({
      campaignStatus: "completed",
      recipientCount: 2,
      counts: { submitted: 1, delivered: 1 },
    })).toBe(true);

    expect(isSuccessfulOnboardingTest({
      campaignStatus: "completed",
      recipientCount: 2,
      counts: { submitted: 1, failed: 1 },
    })).toBe(false);

    expect(isSuccessfulOnboardingTest({
      campaignStatus: "sending",
      recipientCount: 1,
      counts: { submitted: 1 },
    })).toBe(false);
  });
});
