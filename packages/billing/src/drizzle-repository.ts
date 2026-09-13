import { and, desc, eq, sql } from "drizzle-orm";
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

  async appendUsage(input: UsageAppendInput): Promise<UsageAppendResult> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT ${schema.billingSubscriptions.id}
        FROM ${schema.billingSubscriptions}
        WHERE ${schema.billingSubscriptions.id} = ${input.subscriptionId}
          AND ${schema.billingSubscriptions.organizationId} = ${input.organizationId}
        FOR UPDATE
      `);

      const existing = (
        await tx
          .select({ id: schema.billingUsageLedger.id })
          .from(schema.billingUsageLedger)
          .where(
            and(
              eq(schema.billingUsageLedger.organizationId, input.organizationId),
              eq(schema.billingUsageLedger.idempotencyKey, input.idempotencyKey),
            ),
          )
          .limit(1)
      )[0];

      const usageWhere = and(
        eq(schema.billingPeriodUsage.organizationId, input.organizationId),
        eq(schema.billingPeriodUsage.subscriptionId, input.subscriptionId),
        eq(schema.billingPeriodUsage.entitlementKey, input.entitlementKey),
        eq(schema.billingPeriodUsage.periodStart, input.periodStart),
        eq(schema.billingPeriodUsage.periodEnd, input.periodEnd),
      );
      const current = (
        await tx
          .select({ quantity: schema.billingPeriodUsage.quantity })
          .from(schema.billingPeriodUsage)
          .where(usageWhere)
          .limit(1)
      )[0]?.quantity ?? 0;

      if (existing) return { recorded: false, total: current };

      const attemptedTotal = current + input.quantity;
      if (input.limit !== null && attemptedTotal > input.limit) {
        throw new BillingLimitExceededError(input.entitlementKey, input.limit, attemptedTotal);
      }

      await tx.insert(schema.billingUsageLedger).values({
        organizationId: input.organizationId,
        subscriptionId: input.subscriptionId,
        entitlementKey: input.entitlementKey,
        quantity: input.quantity,
        idempotencyKey: input.idempotencyKey,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        occurredAt: input.occurredAt,
        metadata: input.metadata,
      });

      await tx
        .insert(schema.billingPeriodUsage)
        .values({
          organizationId: input.organizationId,
          subscriptionId: input.subscriptionId,
          entitlementKey: input.entitlementKey,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          quantity: input.quantity,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            schema.billingPeriodUsage.organizationId,
            schema.billingPeriodUsage.subscriptionId,
            schema.billingPeriodUsage.entitlementKey,
            schema.billingPeriodUsage.periodStart,
            schema.billingPeriodUsage.periodEnd,
          ],
          set: {
            quantity: sql`${schema.billingPeriodUsage.quantity} + ${input.quantity}`,
            updatedAt: new Date(),
          },
        });

      return { recorded: true, total: attemptedTotal };
    });
  }
}
