import { and, count, eq, sql } from "drizzle-orm";
import {
  buildEligibleAudiencePredicate,
  createDatabase,
  normalizeAudienceDefinition,
  schema,
} from "@wa/db";

type Database = ReturnType<typeof createDatabase>["db"];

export type CampaignDeferralResult =
  | { deferred: true; scheduledAt: string | null }
  | { deferred: false };

export function checkCampaignDeferral(campaignStatus: string, scheduledAt: Date | null): CampaignDeferralResult {
  if (campaignStatus === "scheduled") {
    return { deferred: true, scheduledAt: scheduledAt?.toISOString() ?? null };
  }
  return { deferred: false };
}

export type SnapshotResult =
  | { terminal: "failed"; reason: string }
  | { snapshotCreated: true; recipientCount: number; snapshotAt: Date };

export async function createRecipientSnapshot(
  db: Database,
  campaignId: string,
  organizationId: string,
  audienceDefinition: ReturnType<typeof normalizeAudienceDefinition>,
): Promise<SnapshotResult> {
  const audiencePredicate = buildEligibleAudiencePredicate(audienceDefinition, organizationId);

  await db.execute(sql`
    INSERT INTO campaign_recipients (
      id,
      organization_id,
      campaign_id,
      contact_id,
      phone_e164,
      display_name,
      status,
      created_at,
      updated_at
    )
    SELECT
      gen_random_uuid(),
      ${organizationId}::uuid,
      ${campaignId}::uuid,
      c.id,
      c.phone_e164,
      c.display_name,
      'pending',
      now(),
      now()
    FROM contacts c
    WHERE ${audiencePredicate}
    ON CONFLICT (campaign_id, contact_id) DO NOTHING
  `);

  const [snapshotCount] = await db
    .select({ total: count() })
    .from(schema.campaignRecipients)
    .where(and(
      eq(schema.campaignRecipients.campaignId, campaignId),
      eq(schema.campaignRecipients.organizationId, organizationId),
    ));

  const total = snapshotCount?.total ?? 0;
  if (total === 0) {
    await db
      .update(schema.campaigns)
      .set({ status: "failed", recipientCount: 0, updatedAt: new Date() })
      .where(and(
        eq(schema.campaigns.id, campaignId),
        eq(schema.campaigns.organizationId, organizationId),
      ));
    return { terminal: "failed", reason: "no-eligible-recipients" };
  }

  const snapshotAt = new Date();
  await db
    .update(schema.campaigns)
    .set({
      recipientCount: total,
      snapshotCreatedAt: snapshotAt,
      startedAt: snapshotAt,
      status: "sending",
      updatedAt: snapshotAt,
    })
    .where(and(
      eq(schema.campaigns.id, campaignId),
      eq(schema.campaigns.organizationId, organizationId),
    ));

  return { snapshotCreated: true, recipientCount: total, snapshotAt };
}
