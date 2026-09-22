import { and, desc, eq, lte, sql } from "drizzle-orm";
import { createDatabase, schema } from "@wa/db";
import {
  BillingLimitExceededError,
  type BillingEntitlementSnapshot,
  type BillingRepository,
  type BillingSubscriptionSnapshot,
  type EntitlementKey,
  type UsageAppendInput,
  type UsageAppendResult,
} from "./entitlements";

type BillingDb = ReturnType<typeof createDatabase>["db"];

export class DrizzleBillingRepository implements BillingRepository {
  constructor(private readonly db: BillingDb) {}

  async getCurrentSubscription(organizationId: string, _at: Date): Promise<BillingSubscriptionSnapshot | null> {
    const row = (
      await this.db
        .select({
          organizationId: schema.billingSubscriptions.organizationId,
          subscriptionId: schema.billingSubscriptions.id,
          planVersionId: schema.billingSubscriptions.planVersionId,
          planCode: schema.billingPlans.code,
          planName: schema.billingPlans.name,
          status: schema.billingSubscriptions.status,
          isManual: schema.billingSubscriptions.isManual,
          currentPeriodStart: schema.billingSubscriptions.currentPeriodStart,
          currentPeriodEnd: schema.billingSubscriptions.currentPeriodEnd,
          trialEndsAt: schema.billingSubscriptions.trialEndsAt,
          graceEndsAt: schema.billingSubscriptions.graceEndsAt,
        })
        .from(schema.billingSubscriptions)
        .innerJoin(schema.billingPlanVersions, eq(schema.billingPlanVersions.id, schema.billingSubscriptions.planVersionId))
        .innerJoin(schema.billingPlans, eq(schema.billingPlans.id, schema.billingPlanVersions.planId))
        .where(eq(schema.billingSubscriptions.organizationId, organizationId))
        .orderBy(desc(schema.billingSubscriptions.createdAt))
        .limit(1)
    )[0];

    return row ?? null;
  }

  async getEntitlement(planVersionId: string, key: EntitlementKey): Promise<BillingEntitlementSnapshot | null> {
    const row = (
      await this.db
        .select({
          enabled: schema.billingPlanEntitlements.enabled,
          limit: schema.billingPlanEntitlements.limitValue,
        })
        .from(schema.billingPlanEntitlements)
        .where(
          and(
            eq(schema.billingPlanEntitlements.planVersionId, planVersionId),
            eq(schema.billingPlanEntitlements.key, key),
          ),
        )
        .limit(1)
    )[0];

    return row ?? null;
  }

  async getUsage(input: {
    organizationId: string;
    subscriptionId: string;
    entitlementKey: EntitlementKey;
    periodStart: Date;
    periodEnd: Date;
  }): Promise<number> {
    const row = (
      await this.db
        .select({ quantity: schema.billingPeriodUsage.quantity })
        .from(schema.billingPeriodUsage)
        .where(
          and(
            eq(schema.billingPeriodUsage.organizationId, input.organizationId),
            eq(schema.billingPeriodUsage.subscriptionId, input.subscriptionId),
            eq(schema.billingPeriodUsage.entitlementKey, input.entitlementKey),
            eq(schema.billingPeriodUsage.periodStart, input.periodStart),
            eq(schema.billingPeriodUsage.periodEnd, input.periodEnd),
          ),
        )
        .limit(1)
    )[0];

    return row?.quantity ?? 0;
  }

  private async appendUnlimitedUsage(input: UsageAppendInput): Promise<UsageAppendResult> {
    const updatedAt = new Date();
    const rows = await this.db.execute(sql<{ total: number }>`
      WITH inserted_ledger AS (
        INSERT INTO ${schema.billingUsageLedger} (
          organization_id,
          subscription_id,
          entitlement_key,
          quantity,
          idempotency_key,
          period_start,
          period_end,
          occurred_at,
          metadata
        )
        VALUES (
          ${input.organizationId},
          ${input.subscriptionId},
          ${input.entitlementKey},
          ${input.quantity},
          ${input.idempotencyKey},
          ${input.periodStart.toISOString()}::timestamptz,
          ${input.periodEnd.toISOString()}::timestamptz,
          ${input.occurredAt.toISOString()}::timestamptz,
          ${JSON.stringify(input.metadata)}::jsonb
        )
        ON CONFLICT (organization_id, idempotency_key) DO NOTHING
        RETURNING 1
      )
      INSERT INTO ${schema.billingPeriodUsage} (
        organization_id,
        subscription_id,
        entitlement_key,
        period_start,
        period_end,
        quantity,
        updated_at
      )
      SELECT
        ${input.organizationId},
        ${input.subscriptionId},
        ${input.entitlementKey},
        ${input.periodStart.toISOString()}::timestamptz,
        ${input.periodEnd.toISOString()}::timestamptz,
        ${input.quantity},
        ${updatedAt.toISOString()}::timestamptz
      FROM inserted_ledger
      ON CONFLICT (
        organization_id,
        subscription_id,
        entitlement_key,
        period_start,
        period_end
      )
      DO UPDATE SET
        quantity = ${schema.billingPeriodUsage.quantity} + EXCLUDED.quantity,
        updated_at = EXCLUDED.updated_at
      RETURNING quantity AS total
    `);

    const row = rows[0];
    if (row) return { recorded: true, total: Number(row.total) };

    return {
      recorded: false,
      total: await this.getUsage({
        organizationId: input.organizationId,
        subscriptionId: input.subscriptionId,
        entitlementKey: input.entitlementKey,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
      }),
    };
  }

  async appendUsage(input: UsageAppendInput): Promise<UsageAppendResult> {
    const limit = input.limit;
    if (limit === null) return this.appendUnlimitedUsage(input);

    if (input.quantity > limit) {
      throw new BillingLimitExceededError(input.entitlementKey, limit, input.quantity);
    }

    return this.db.transaction(async (tx) => {
      const usageWhere = and(
        eq(schema.billingPeriodUsage.organizationId, input.organizationId),
        eq(schema.billingPeriodUsage.subscriptionId, input.subscriptionId),
        eq(schema.billingPeriodUsage.entitlementKey, input.entitlementKey),
        eq(schema.billingPeriodUsage.periodStart, input.periodStart),
        eq(schema.billingPeriodUsage.periodEnd, input.periodEnd),
      );

      const [ledgerEntry] = await tx
        .insert(schema.billingUsageLedger)
        .values({
          organizationId: input.organizationId,
          subscriptionId: input.subscriptionId,
          entitlementKey: input.entitlementKey,
          quantity: input.quantity,
          idempotencyKey: input.idempotencyKey,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          occurredAt: input.occurredAt,
          metadata: input.metadata,
        })
        .onConflictDoNothing({
          target: [
            schema.billingUsageLedger.organizationId,
            schema.billingUsageLedger.idempotencyKey,
          ],
        })
        .returning({ id: schema.billingUsageLedger.id });

      if (!ledgerEntry) {
        const current = (
          await tx
            .select({ quantity: schema.billingPeriodUsage.quantity })
            .from(schema.billingPeriodUsage)
            .where(usageWhere)
            .limit(1)
        )[0]?.quantity ?? 0;
        return { recorded: false, total: current };
      }

      const updatedAt = new Date();
      const [createdUsage] = await tx
        .insert(schema.billingPeriodUsage)
        .values({
          organizationId: input.organizationId,
          subscriptionId: input.subscriptionId,
          entitlementKey: input.entitlementKey,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          quantity: input.quantity,
          updatedAt,
        })
        .onConflictDoNothing({
          target: [
            schema.billingPeriodUsage.organizationId,
            schema.billingPeriodUsage.subscriptionId,
            schema.billingPeriodUsage.entitlementKey,
            schema.billingPeriodUsage.periodStart,
            schema.billingPeriodUsage.periodEnd,
          ],
        })
        .returning({ quantity: schema.billingPeriodUsage.quantity });

      if (createdUsage) return { recorded: true, total: createdUsage.quantity };

      const [updatedUsage] = await tx
        .update(schema.billingPeriodUsage)
        .set({
          quantity: sql`${schema.billingPeriodUsage.quantity} + ${input.quantity}`,
          updatedAt,
        })
        .where(and(
          usageWhere,
          lte(schema.billingPeriodUsage.quantity, limit - input.quantity),
        ))
        .returning({ quantity: schema.billingPeriodUsage.quantity });

      if (updatedUsage) return { recorded: true, total: updatedUsage.quantity };

      const current = (
        await tx
          .select({ quantity: schema.billingPeriodUsage.quantity })
          .from(schema.billingPeriodUsage)
          .where(usageWhere)
          .limit(1)
      )[0]?.quantity ?? 0;

      throw new BillingLimitExceededError(
        input.entitlementKey,
        limit,
        current + input.quantity,
      );
    });
  }
}
