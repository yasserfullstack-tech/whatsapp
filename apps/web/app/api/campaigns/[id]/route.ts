import { and, count, eq } from "drizzle-orm";
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
      completedAt: schema.campaigns.completedAt,
    })
    .from(schema.campaigns)
    .where(and(
      eq(schema.campaigns.id, id),
      eq(schema.campaigns.organizationId, context.workspace.organizationId),
    ))
    .limit(1);

  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  const rows = await db
    .select({ status: schema.campaignRecipients.status, total: count() })
    .from(schema.campaignRecipients)
    .where(eq(schema.campaignRecipients.campaignId, campaign.id))
    .groupBy(schema.campaignRecipients.status);

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

  const processed = counts.submitted + counts.sent + counts.delivered + counts.read + counts.failed + counts.skipped;
  return NextResponse.json({
    ...campaign,
    counts,
    processed,
    progress: campaign.recipientCount > 0 ? Math.min(1, processed / campaign.recipientCount) : 0,
  });
}
