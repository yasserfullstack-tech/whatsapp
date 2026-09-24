import { and, eq, isNotNull, or, sql } from "drizzle-orm";
import { createDatabase, schema } from "@wa/db";

type Database = ReturnType<typeof createDatabase>["db"];

export async function claimCampaignRecipientForSend(
  db: Database,
  input: {
    organizationId: string;
    campaignId: string;
    recipientId: string;
    reservationQueuedAt: Date;
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
      eq(schema.campaignRecipients.queuedAt, input.reservationQueuedAt),
      // Claiming and checking the campaign control state must happen in the same
      // statement. A paused/cancelled campaign therefore cannot start another
      // provider send merely because its recipient was already queued.
      sql`exists (
        select 1
        from ${schema.campaigns}
        where ${schema.campaigns.id} = ${input.campaignId}
          and ${schema.campaigns.organizationId} = ${input.organizationId}
          and ${schema.campaigns.status} = 'sending'
      )`,
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

  return claimed ?? null;
}
