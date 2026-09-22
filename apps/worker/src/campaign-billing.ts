import { and, count, eq, sql } from "drizzle-orm";
import {
  BillingEntitlementError,
  BillingLimitExceededError,
  type EntitlementService,
} from "@wa/billing";
import { createDatabase, schema } from "@wa/db";

type Database = ReturnType<typeof createDatabase>["db"];

export type CampaignUsageReservation =
  | { reserved: true; recipients: number; legacyMetered: number; recorded: boolean }
  | {
      reserved: false;
      recipients: number;
      legacyMetered: number;
      reason: "billing_entitlement_denied" | "billing_limit_exceeded";
    };

export async function reserveCampaignRecipientUsage(
  db: Database,
  entitlements: EntitlementService,
  input: {
    organizationId: string;
    campaignId: string;
    occurredAt?: Date;
  },
): Promise<CampaignUsageReservation> {
  const [counts] = await db
    .select({
      recipients: count(),
      legacyMetered: sql<number>`count(${schema.billingUsageLedger.id})::int`,
    })
    .from(schema.campaignRecipients)
    .leftJoin(
      schema.billingUsageLedger,
      and(
        eq(schema.billingUsageLedger.organizationId, input.organizationId),
        eq(
          schema.billingUsageLedger.idempotencyKey,
          sql`'campaign-recipient:' || ${schema.campaignRecipients.id}::text`,
        ),
      ),
    )
    .where(and(
      eq(schema.campaignRecipients.organizationId, input.organizationId),
      eq(schema.campaignRecipients.campaignId, input.campaignId),
    ));

  const recipients = Number(counts?.recipients ?? 0);
  const legacyMetered = Number(counts?.legacyMetered ?? 0);
  const quantity = Math.max(0, recipients - legacyMetered);

  if (quantity === 0) {
    return { reserved: true, recipients, legacyMetered, recorded: false };
  }

  try {
    const result = await entitlements.recordUsage({
      organizationId: input.organizationId,
      key: "monthly_campaign_recipients",
      quantity,
      idempotencyKey: `campaign-recipients:${input.campaignId}`,
      occurredAt: input.occurredAt ?? new Date(),
      metadata: {
        campaignId: input.campaignId,
        recipientCount: recipients,
        legacyMetered,
        reservationMode: "campaign_snapshot",
      },
    });

    return {
      reserved: true,
      recipients,
      legacyMetered,
      recorded: result.recorded,
    };
  } catch (error) {
    const reason = error instanceof BillingLimitExceededError
      ? "billing_limit_exceeded" as const
      : error instanceof BillingEntitlementError
        ? "billing_entitlement_denied" as const
        : null;

    if (!reason) throw error;

    await db
      .update(schema.campaigns)
      .set({ status: "paused", updatedAt: new Date() })
      .where(and(
        eq(schema.campaigns.id, input.campaignId),
        eq(schema.campaigns.organizationId, input.organizationId),
      ));

    return {
      reserved: false,
      recipients,
      legacyMetered,
      reason,
    };
  }
}
