import { and, eq, gt, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import { createDatabase, schema } from "@wa/db";
import { createCampaignDispatchQueue } from "@wa/queue";
import { claimDueScheduledCampaigns } from "./campaign-scheduling";
import {
  UNKNOWN_SEND_OUTCOME_CODE,
  UNKNOWN_SEND_OUTCOME_ERROR,
} from "./campaign-send-state";

type Database = ReturnType<typeof createDatabase>["db"];
type DispatchQueue = ReturnType<typeof createCampaignDispatchQueue>;

const STALE_QUEUED_MS = 120_000;
const RECONCILE_EVERY_MS = 30_000;

export function startCampaignReconciliation(input: {
  db: Database;
  dispatchQueue: DispatchQueue;
}) {
  const { db, dispatchQueue } = input;

  const reconcile = async () => {
    const staleBefore = new Date(Date.now() - STALE_QUEUED_MS);
    const reconciliationAt = new Date();

    // PostgreSQL owns schedules. The conditional scheduled -> dispatching claim
    // is safe across concurrent worker processes; the normal dispatcher queue is
    // then reconstructed from DB state just like any other active campaign.
    await claimDueScheduledCampaigns(db, reconciliationAt);

    await db
      .update(schema.campaignRecipients)
      .set({
        status: "failed",
        lastError: UNKNOWN_SEND_OUTCOME_ERROR,
        errorCode: UNKNOWN_SEND_OUTCOME_CODE,
        failedAt: reconciliationAt,
        updatedAt: reconciliationAt,
      })
      .where(
        and(
          eq(schema.campaignRecipients.status, "queued"),
          gt(schema.campaignRecipients.attemptCount, 0),
          lt(schema.campaignRecipients.lastAttemptAt, staleBefore),
          isNull(schema.campaignRecipients.lastError),
          isNull(schema.campaignRecipients.wamid),
        ),
      );

    await db
      .update(schema.campaignRecipients)
      .set({
        status: "pending",
        queuedAt: null,
        lastError: "Recovered a stale queue reservation",
        updatedAt: reconciliationAt,
      })
      .where(
        and(
          eq(schema.campaignRecipients.status, "queued"),
          lt(schema.campaignRecipients.queuedAt, staleBefore),
          isNull(schema.campaignRecipients.wamid),
          or(
            eq(schema.campaignRecipients.attemptCount, 0),
            isNotNull(schema.campaignRecipients.lastError),
          ),
        ),
      );

    const activeCampaigns = await db
      .select({
        id: schema.campaigns.id,
        organizationId: schema.campaigns.organizationId,
      })
      .from(schema.campaigns)
      .where(inArray(schema.campaigns.status, ["dispatching", "sending"]));

    for (const campaign of activeCampaigns) {
      await dispatchQueue.add(
        "dispatch-campaign",
        { organizationId: campaign.organizationId, campaignId: campaign.id },
        { jobId: `campaign-${campaign.id}` },
      );
    }
  };

  void reconcile().catch((error) => console.error("Campaign reconciliation failed", error));
  const reconciliationTimer = setInterval(() => {
    void reconcile().catch((error) => console.error("Campaign reconciliation failed", error));
  }, RECONCILE_EVERY_MS);
  reconciliationTimer.unref();

  return {
    close() {
      clearInterval(reconciliationTimer);
    },
  };
}
