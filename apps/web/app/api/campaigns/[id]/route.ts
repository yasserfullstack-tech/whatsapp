import { and, count, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { schema } from "@wa/db";
import { getAuthContext } from "@/lib/auth-context";
import { db } from "@/lib/server";

type RouteContext = { params: Promise<{ id: string }> };

type RecipientCounts = {
  pending: number;
  queued: number;
  submitted: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  skipped: number;
};

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

export async function GET(_request: Request, routeContext: RouteContext) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await routeContext.params;
  const [campaign] = await db
    .select({
      id: schema.campaigns.id,
      name: schema.campaigns.name,
      status: schema.campaigns.status,
      recipientCount: schema.campaigns.recipientCount,
      snapshotCreatedAt: schema.campaigns.snapshotCreatedAt,
      startedAt: schema.campaigns.startedAt,
      dispatchCompletedAt: schema.campaigns.dispatchCompletedAt,
      completedAt: schema.campaigns.completedAt,
      createdAt: schema.campaigns.createdAt,
    })
    .from(schema.campaigns)
    .where(and(
      eq(schema.campaigns.id, id),
      eq(schema.campaigns.organizationId, context.workspace.organizationId),
    ))
    .limit(1);

  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  const [rows, recentFailures] = await Promise.all([
    db
      .select({ status: schema.campaignRecipients.status, total: count() })
      .from(schema.campaignRecipients)
      .where(eq(schema.campaignRecipients.campaignId, campaign.id))
      .groupBy(schema.campaignRecipients.status),
    db
      .select({
        id: schema.campaignRecipients.id,
        displayName: schema.campaignRecipients.displayName,
        phoneE164: schema.campaignRecipients.phoneE164,
        errorCode: schema.campaignRecipients.errorCode,
        lastError: schema.campaignRecipients.lastError,
        attemptCount: schema.campaignRecipients.attemptCount,
        failedAt: schema.campaignRecipients.failedAt,
      })
      .from(schema.campaignRecipients)
      .where(and(
        eq(schema.campaignRecipients.campaignId, campaign.id),
        eq(schema.campaignRecipients.status, "failed"),
      ))
      .orderBy(desc(schema.campaignRecipients.failedAt))
      .limit(20),
  ]);

  const counts: RecipientCounts = {
    pending: 0,
    queued: 0,
    submitted: 0,
    sent: 0,
    delivered: 0,
    read: 0,
    failed: 0,
    skipped: 0,
  };
  for (const row of rows) counts[row.status] = row.total;

  const accepted = counts.submitted + counts.sent + counts.delivered + counts.read;
  const sent = counts.sent + counts.delivered + counts.read;
  const delivered = counts.delivered + counts.read;
  const read = counts.read;
  const processed = accepted + counts.failed + counts.skipped;

  return NextResponse.json({
    ...campaign,
    counts,
    funnel: {
      accepted,
      sent,
      delivered,
      read,
      failed: counts.failed,
    },
    rates: {
      acceptance: ratio(accepted, campaign.recipientCount),
      delivery: ratio(delivered, accepted),
      read: ratio(read, delivered),
      failure: ratio(counts.failed, campaign.recipientCount),
    },
    processed,
    progress: campaign.recipientCount > 0 ? Math.min(1, processed / campaign.recipientCount) : 0,
    submissionSettled: counts.pending + counts.queued + counts.submitted === 0,
    recentFailures,
  });
}
