import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { schema } from "@wa/db";
import { getAuthContext } from "@/lib/auth-context";
import { campaignDispatchQueue, db } from "@/lib/server";
import { can } from "@/lib/workspace-access";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const controlSchema = z.object({ action: z.enum(["pause", "resume", "cancel"]) });

export async function POST(request: Request, routeContext: RouteContext) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(context.workspace.role, "campaigns.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = controlSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid campaign control action" }, { status: 400 });

  const { id } = await routeContext.params;
  const organizationId = context.workspace.organizationId;
  const [campaign] = await db
    .select({ id: schema.campaigns.id, status: schema.campaigns.status })
    .from(schema.campaigns)
    .where(and(eq(schema.campaigns.id, id), eq(schema.campaigns.organizationId, organizationId)))
    .limit(1);

  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  if (parsed.data.action === "pause") {
    if (campaign.status !== "sending") {
      return NextResponse.json({ error: `Campaign cannot be paused from ${campaign.status}` }, { status: 409 });
    }
    await db.update(schema.campaigns)
      .set({ status: "paused", updatedAt: new Date() })
      .where(and(eq(schema.campaigns.id, campaign.id), eq(schema.campaigns.status, "sending")));
    return NextResponse.json({ status: "paused" });
  }

  if (parsed.data.action === "resume") {
    if (campaign.status !== "paused") {
      return NextResponse.json({ error: `Campaign cannot be resumed from ${campaign.status}` }, { status: 409 });
    }

    await db.update(schema.campaigns)
      .set({ status: "sending", updatedAt: new Date() })
      .where(and(eq(schema.campaigns.id, campaign.id), eq(schema.campaigns.status, "paused")));

    try {
      await campaignDispatchQueue.add(
        "dispatch-campaign",
        { organizationId, campaignId: campaign.id },
        { jobId: `campaign-${campaign.id}` },
      );
    } catch (error) {
      await db.update(schema.campaigns)
        .set({ status: "paused", updatedAt: new Date() })
        .where(eq(schema.campaigns.id, campaign.id));
      console.error("Could not resume campaign dispatcher", error);
      return NextResponse.json({ error: "Campaign is still paused because the dispatcher could not be queued" }, { status: 503 });
    }

    return NextResponse.json({ status: "sending" });
  }

  if (campaign.status !== "sending" && campaign.status !== "paused") {
    return NextResponse.json({ error: `Campaign cannot be cancelled from ${campaign.status}` }, { status: 409 });
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(schema.campaigns)
      .set({ status: "cancelled", completedAt: now, updatedAt: now })
      .where(and(
        eq(schema.campaigns.id, campaign.id),
        inArray(schema.campaigns.status, ["sending", "paused"]),
      ));

    await tx.update(schema.campaignRecipients)
      .set({
        status: "skipped",
        errorCode: "CAMPAIGN_CANCELLED",
        lastError: "Campaign cancelled before this recipient was submitted to Meta",
        updatedAt: now,
      })
      .where(and(
        eq(schema.campaignRecipients.campaignId, campaign.id),
        eq(schema.campaignRecipients.organizationId, organizationId),
        inArray(schema.campaignRecipients.status, ["pending", "queued"]),
      ));
  });

  return NextResponse.json({ status: "cancelled" });
}
