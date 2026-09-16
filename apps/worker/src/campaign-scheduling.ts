import { and, asc, eq, lte } from "drizzle-orm";
import { createDatabase, schema } from "@wa/db";

type Database = ReturnType<typeof createDatabase>["db"];

export type ClaimedScheduledCampaign = {
  id: string;
  organizationId: string;
};

/**
 * Claim due campaigns with a compare-and-set transition. Multiple worker
 * processes may select the same candidate, but only one can move a row from
 * scheduled -> dispatching. Queue publication is reconciled separately, so a
 * crash after the claim is recoverable without moving the schedule backwards.
 */
export async function claimDueScheduledCampaigns(
  db: Database,
  now = new Date(),
  limit = 100,
): Promise<ClaimedScheduledCampaign[]> {
  const candidates = await db
    .select({
      id: schema.campaigns.id,
      organizationId: schema.campaigns.organizationId,
    })
    .from(schema.campaigns)
    .where(and(
      eq(schema.campaigns.status, "scheduled"),
      lte(schema.campaigns.scheduledAt, now),
    ))
    .orderBy(asc(schema.campaigns.scheduledAt), asc(schema.campaigns.id))
    .limit(limit);

  const claimed: ClaimedScheduledCampaign[] = [];
  for (const candidate of candidates) {
    const [row] = await db
      .update(schema.campaigns)
      .set({ status: "dispatching", updatedAt: now })
      .where(and(
        eq(schema.campaigns.id, candidate.id),
        eq(schema.campaigns.organizationId, candidate.organizationId),
        eq(schema.campaigns.status, "scheduled"),
        lte(schema.campaigns.scheduledAt, now),
      ))
      .returning({
        id: schema.campaigns.id,
        organizationId: schema.campaigns.organizationId,
      });
    if (row) claimed.push(row);
  }

  return claimed;
}
