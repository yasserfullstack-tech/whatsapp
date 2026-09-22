export const ONBOARDING_TEST_RECIPIENT_LIMIT = 5;

export type OnboardingTestRecipientCounts = {
  pending?: number;
  queued?: number;
  submitted?: number;
  sent?: number;
  delivered?: number;
  read?: number;
  failed?: number;
  skipped?: number;
};

export function validateOnboardingTestRequest(input: {
  eligibleContacts: number;
  scheduledAt: Date | null;
}): string | null {
  if (input.scheduledAt) return "Onboarding test messages must be sent immediately";
  if (input.eligibleContacts > ONBOARDING_TEST_RECIPIENT_LIMIT) {
    return `Onboarding test campaigns are limited to ${ONBOARDING_TEST_RECIPIENT_LIMIT} eligible contacts`;
  }
  return null;
}

export function isSuccessfulOnboardingTest(input: {
  campaignStatus: string | null | undefined;
  recipientCount: number;
  counts: OnboardingTestRecipientCounts;
}): boolean {
  if (input.campaignStatus !== "completed") return false;
  if (input.recipientCount < 1 || input.recipientCount > ONBOARDING_TEST_RECIPIENT_LIMIT) return false;

  const accepted =
    (input.counts.submitted ?? 0) +
    (input.counts.sent ?? 0) +
    (input.counts.delivered ?? 0) +
    (input.counts.read ?? 0);
  const unresolved = (input.counts.pending ?? 0) + (input.counts.queued ?? 0);
  const unsuccessful = (input.counts.failed ?? 0) + (input.counts.skipped ?? 0);

  return accepted === input.recipientCount && unresolved === 0 && unsuccessful === 0;
}
