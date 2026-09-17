import { and, count, eq, ne } from "drizzle-orm";
import { schema } from "@wa/db";
import { db } from "@/lib/server";
import { deriveOnboardingProgress, type OnboardingProgress } from "@/lib/onboarding-model";
import { isSuccessfulOnboardingTest, type OnboardingTestRecipientCounts } from "@/lib/onboarding-test-mode";

export async function getOnboardingProgress(
  organizationId: string,
  externalAuthId: string,
): Promise<OnboardingProgress> {
  const onboarding = await db.select().from(schema.organizationOnboarding)
    .where(eq(schema.organizationOnboarding.organizationId, organizationId))
    .limit(1)
    .then((rows) => rows[0]);

  const [
    authRows,
    preferenceRows,
    phoneRows,
    contactRows,
    templateRows,
    listRows,
    segmentRows,
    campaignRows,
    testCampaignRows,
    testRecipientRows,
  ] = await Promise.all([
    db.select({ emailVerified: schema.authUser.emailVerified }).from(schema.authUser)
      .where(eq(schema.authUser.id, externalAuthId)).limit(1),
    db.select({ total: count() }).from(schema.workspacePreferences)
      .where(eq(schema.workspacePreferences.organizationId, organizationId)),
    db.select({ total: count() }).from(schema.whatsappPhoneNumbers)
      .where(and(
        eq(schema.whatsappPhoneNumbers.organizationId, organizationId),
        eq(schema.whatsappPhoneNumbers.status, "connected"),
      )),
    db.select({ total: count() }).from(schema.contacts)
      .where(eq(schema.contacts.organizationId, organizationId)),
    db.select({ total: count() }).from(schema.templates)
      .where(and(
        eq(schema.templates.organizationId, organizationId),
        eq(schema.templates.status, "approved"),
      )),
    db.select({ total: count() }).from(schema.contactLists)
      .where(eq(schema.contactLists.organizationId, organizationId)),
    db.select({ total: count() }).from(schema.audienceSegments)
      .where(eq(schema.audienceSegments.organizationId, organizationId)),
    onboarding?.testCampaignId
      ? db.select({ total: count() }).from(schema.campaigns)
          .where(and(
            eq(schema.campaigns.organizationId, organizationId),
            ne(schema.campaigns.id, onboarding.testCampaignId),
          ))
      : db.select({ total: count() }).from(schema.campaigns)
          .where(eq(schema.campaigns.organizationId, organizationId)),
    onboarding?.testCampaignId
      ? db.select({
          status: schema.campaigns.status,
          recipientCount: schema.campaigns.recipientCount,
        }).from(schema.campaigns)
          .where(and(
            eq(schema.campaigns.id, onboarding.testCampaignId),
            eq(schema.campaigns.organizationId, organizationId),
          ))
          .limit(1)
      : Promise.resolve([]),
    onboarding?.testCampaignId
      ? db.select({ status: schema.campaignRecipients.status, total: count() })
          .from(schema.campaignRecipients)
          .where(and(
            eq(schema.campaignRecipients.campaignId, onboarding.testCampaignId),
            eq(schema.campaignRecipients.organizationId, organizationId),
          ))
          .groupBy(schema.campaignRecipients.status)
      : Promise.resolve([]),
  ]);

  const testCounts: OnboardingTestRecipientCounts = {};
  for (const row of testRecipientRows) testCounts[row.status] = row.total;
  const testCampaign = testCampaignRows[0];

  return deriveOnboardingProgress({
    emailVerified: authRows[0]?.emailVerified ?? false,
    workspaceConfigured: (preferenceRows[0]?.total ?? 0) > 0,
    whatsappConnected: (phoneRows[0]?.total ?? 0) > 0,
    contactsImported: (contactRows[0]?.total ?? 0) > 0,
    consentConfirmed: Boolean(onboarding?.consentConfirmedAt),
    templateReady: (templateRows[0]?.total ?? 0) > 0,
    audienceReady: (listRows[0]?.total ?? 0) > 0 || (segmentRows[0]?.total ?? 0) > 0,
    testSent: isSuccessfulOnboardingTest({
      campaignStatus: testCampaign?.status,
      recipientCount: testCampaign?.recipientCount ?? 0,
      counts: testCounts,
    }),
    campaignLaunched: (campaignRows[0]?.total ?? 0) > 0,
    skippedSteps: onboarding?.skippedSteps ?? [],
    dismissed: Boolean(onboarding?.skippedAt),
    manuallyCompleted: Boolean(onboarding?.completedAt),
  });
}
