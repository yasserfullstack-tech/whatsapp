import { and, eq } from "drizzle-orm";
import type { Database } from "./index";
import { schema } from "./index";

export type CancelResult =
  | { success: true; status: "cancelled" }
  | { success: false; error: "not-scheduled"; status: string };

export type RescheduleResult =
  | { success: true; status: "scheduled"; scheduledAt: Date }
  | { success: false; error: "not-scheduled"; status: string | null };

export async function cancelScheduledCampaign(
  db: Database,
  campaignId: string,
  organizationId: string,
): Promise<CancelResult> {
  const [campaign] = await db
    .select({ id: schema.campaigns.id, status: schema.campaigns.status })
    .from(schema.campaigns)
    .where(and(eq(schema.campaigns.id, campaignId), eq(schema.campaigns.organizationId, organizationId)))
    .limit(1);

  if (!campaign) return { success: false, error: "not-scheduled", status: "missing" };
  if (campaign.status !== "scheduled") return { success: false, error: "not-scheduled", status: campaign.status };

  const now = new Date();
  const [cancelled] = await db.update(schema.campaigns)
    .set({ status: "cancelled", completedAt: now, updatedAt: now })
    .where(and(
      eq(schema.campaigns.id, campaignId),
      eq(schema.campaigns.organizationId, organizationId),
      eq(schema.campaigns.status, "scheduled"),
    ))
    .returning({ id: schema.campaigns.id });

  if (!cancelled) {
    const [current] = await db
      .select({ status: schema.campaigns.status })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);
    return { success: false, error: "not-scheduled", status: current?.status ?? "dispatching" };
  }
  return { success: true, status: "cancelled" };
}

export async function rescheduleCampaign(
  db: Database,
  campaignId: string,
  organizationId: string,
  scheduledAt: Date,
): Promise<RescheduleResult> {
  const [campaign] = await db
    .select({ id: schema.campaigns.id, status: schema.campaigns.status })
    .from(schema.campaigns)
    .where(and(eq(schema.campaigns.id, campaignId), eq(schema.campaigns.organizationId, organizationId)))
    .limit(1);

  if (!campaign) return { success: false, error: "not-scheduled", status: "missing" };
  if (campaign.status !== "scheduled") return { success: false, error: "not-scheduled", status: campaign.status };

  const [rescheduled] = await db.update(schema.campaigns)
    .set({ scheduledAt, updatedAt: new Date() })
    .where(and(
      eq(schema.campaigns.id, campaignId),
      eq(schema.campaigns.organizationId, organizationId),
      eq(schema.campaigns.status, "scheduled"),
    ))
    .returning({ id: schema.campaigns.id });

  if (!rescheduled) {
    const [current] = await db
      .select({ status: schema.campaigns.status })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);
    return { success: false, error: "not-scheduled", status: current?.status ?? "dispatching" };
  }
  return { success: true, status: "scheduled", scheduledAt };
}