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
  private readonly entitlementCache = new Map<string, {
    value: BillingEntitlementSnapshot | null;
    expiresAt: number;
  }>();

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
    const cacheKey = `${planVersionId}:${key}`;
    const now = Date.now();
    const cached = this.entitlementCache.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.value;

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
    )[0] ?? null;

    // Plan-version entitlement metadata changes far less frequently than send
    // traffic. A short cache removes a per-recipient read while still picking
    // up administrative changes quickly. Subscription status remains uncached.
    this.entitlementCache.set(cacheKey, { value: row, expiresAt: now + 1_000 });
    return row;
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
        .select({
          quantity: sql<number>`coalesce(sum(${schema.billingUsageLedger.quantity}), 0)::int`,
        })
        .from(schema.billingUsageLedger)
        .where(
          and(
            eq(schema.billingUsageLedger.organizationId, input.organizationId),
            eq(schema.billingUsageLedger.subscriptionId, input.subscriptionId),
            eq(schema.billingUsageLedger.entitlementKey, input.entitlementKey),
            eq(schema.billingUsageLedger.periodStart, input.periodStart),
            eq(schema.billingUsageLedger.periodEnd, input.periodEnd),
          ),
        )
    )[0];

    return Number(row?.quantity ?? 0);
  }

  private async appendUnlimitedUsage(input: UsageAppendInput): Promise<UsageAppendResult> {
    const [ledgerEntry] = await this.db
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

    // Unlimited plans do not need the shared billing_period_usage row for
    // enforcement. The immutable ledger is authoritative and getUsage() sums
    // it when an exact total is actually requested. Hot send paths can skip
    // that aggregate read as well.
    if (input.includeTotal === false) {
      return { recorded: Boolean(ledgerEntry), total: 0 };
    }

    return {
      recorded: Boolean(ledgerEntry),
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
