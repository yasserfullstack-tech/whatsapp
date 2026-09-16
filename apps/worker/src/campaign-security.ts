import { and, eq, isNotNull, or, sql } from "drizzle-orm";
import {
  BillingEntitlementError,
  BillingLimitExceededError,
  DrizzleBillingRepository,
  EntitlementService,
} from "@wa/billing";
import { createDatabase, schema } from "@wa/db";

type Database = ReturnType<typeof createDatabase>["db"];

export async function claimCampaignRecipientForSend(
  db: Database,
  input: {
    organizationId: string;
    campaignId: string;
    recipientId: string;
    now: Date;
  },
) {
  const [claimed] = await db
    .update(schema.campaignRecipients)
    .set({
      attemptCount: sql`${schema.campaignRecipients.attemptCount} + 1`,
      lastAttemptAt: input.now,
      lastError: null,
      errorCode: null,
      updatedAt: input.now,
    })
    .where(and(
      eq(schema.campaignRecipients.id, input.recipientId),
      eq(schema.campaignRecipients.campaignId, input.campaignId),
      eq(schema.campaignRecipients.organizationId, input.organizationId),
      eq(schema.campaignRecipients.status, "queued"),
      or(
        eq(schema.campaignRecipients.attemptCount, 0),
        isNotNull(schema.campaignRecipients.lastError),
      ),
    ))
    .returning({
      id: schema.campaignRecipients.id,
      phoneE164: schema.campaignRecipients.phoneE164,
      attemptCount: schema.campaignRecipients.attemptCount,
    });

  if (!claimed) return null;

  const entitlements = new EntitlementService(new DrizzleBillingRepository(db));
  try {
    await entitlements.recordUsage({
      organizationId: input.organizationId,
      key: "monthly_campaign_recipients",
      quantity: 1,
      // One recipient is billable once for the subscription period. Provider
      // retries reuse this key and therefore do not increment usage again.
      idempotencyKey: `campaign-recipient:${claimed.id}`,
      occurredAt: input.now,
      metadata: {
        campaignId: input.campaignId,
        recipientId: claimed.id,
      },
    });
  } catch (error) {
    if (error instanceof BillingEntitlementError || error instanceof BillingLimitExceededError) {
      await db.transaction(async (tx) => {
        await tx
          .update(schema.campaignRecipients)
          .set({
            status: "pending",
            attemptCount: 0,
            lastAttemptAt: null,
            lastError: null,
            errorCode: null,
            updatedAt: new Date(),
          })
          .where(and(
            eq(schema.campaignRecipients.id, claimed.id),
            eq(schema.campaignRecipients.campaignId, input.campaignId),
            eq(schema.campaignRecipients.organizationId, input.organizationId),
            eq(schema.campaignRecipients.status, "queued"),
            eq(schema.campaignRecipients.attemptCount, claimed.attemptCount),
          ));

        await tx
          .update(schema.campaigns)
          .set({ status: "paused", updatedAt: new Date() })
          .where(and(
            eq(schema.campaigns.id, input.campaignId),
            eq(schema.campaigns.organizationId, input.organizationId),
          ));
      });
    }
    throw error;
  }

  return claimed;
}
