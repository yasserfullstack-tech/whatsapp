import { and, eq, inArray, sql } from "drizzle-orm";
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
      updatedAt: input.now,
    })
    .where(and(
      eq(schema.campaignRecipients.id, input.recipientId),
      eq(schema.campaignRecipients.campaignId, input.campaignId),
      eq(schema.campaignRecipients.organizationId, input.organizationId),
      inArray(schema.campaignRecipients.status, ["pending", "queued"]),
    ))
    .returning({
      id: schema.campaignRecipients.id,
      phoneE164: schema.campaignRecipients.phoneE164,
    });

  return claimed ?? null;
}
