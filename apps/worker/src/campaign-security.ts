import { and, eq, isNotNull, or, sql } from "drizzle-orm";
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

  return claimed ?? null;
}
