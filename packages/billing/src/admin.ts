import { and, desc, eq, sql } from "drizzle-orm";
import { createDatabase, schema } from "@wa/db";
import type { BillingSubscriptionStatus, EntitlementKey } from "./entitlements";

type BillingDb = ReturnType<typeof createDatabase>["db"];

export const billingAuditActions = {
  planChanged: "billing.plan_changed",
  subscriptionActivated: "billing.subscription_activated",
  subscriptionCancelled: "billing.subscription_cancelled",
  subscriptionSuspended: "billing.subscription_suspended",
  manualOverride: "billing.manual_override",
} as const;

type BillingAuditAction = (typeof billingAuditActions)[keyof typeof billingAuditActions];

function addMonths(value: Date, months: number): Date {
  const next = new Date(value);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function slugPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36) || "custom";
}

async function billingAccountFor(db: BillingDb, organizationId: string) {
  const existing = (
    await db
      .select()
      .from(schema.billingAccounts)
      .where(eq(schema.billingAccounts.organizationId, organizationId))
      .limit(1)
  )[0];
  if (existing) return existing;

  const inserted = await db
    .insert(schema.billingAccounts)
    .values({ organizationId })
    .onConflictDoNothing({ target: schema.billingAccounts.organizationId })
    .returning();
  if (inserted[0]) return inserted[0];

  const concurrent = (
    await db
      .select()
      .from(schema.billingAccounts)
      .where(eq(schema.billingAccounts.organizationId, organizationId))
      .limit(1)
  )[0];
  if (!concurrent) throw new Error("Could not create billing account");
  return concurrent;
}

async function audit(
  db: BillingDb,
  input: {
    organizationId: string;
    actorUserId: string | null;
    action: BillingAuditAction;
    targetType: string;
    targetId: string | null;
    metadata: Record<string, unknown>;
  },
) {
  await db.insert(schema.workspaceAuditLogs).values({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    metadata: input.metadata,
  });
}

async function currentSubscription(db: BillingDb, organizationId: string) {
  return (
    await db
      .select()
      .from(schema.billingSubscriptions)
      .where(eq(schema.billingSubscriptions.organizationId, organizationId))
      .orderBy(desc(schema.billingSubscriptions.createdAt))
      .limit(1)
  )[0] ?? null;
}

export async function ensureDefaultBilling(db: BillingDb, organizationId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${organizationId}))`);

    let account = (
      await tx
        .select()
        .from(schema.billingAccounts)
        .where(eq(schema.billingAccounts.organizationId, organizationId))
        .limit(1)
    )[0];

    if (!account) {
      account = (
        await tx.insert(schema.billingAccounts).values({ organizationId }).returning()
      )[0];
    }
    if (!account) throw new Error("Could not initialize billing account");

    const existing = (
      await tx
        .select({ id: schema.billingSubscriptions.id })
        .from(schema.billingSubscriptions)
        .where(eq(schema.billingSubscriptions.organizationId, organizationId))
        .limit(1)
    )[0];
    if (existing) return;

    const starter = (
      await tx
        .select({ planVersionId: schema.billingPlanVersions.id })
        .from(schema.billingPlanVersions)
        .innerJoin(schema.billingPlans, eq(schema.billingPlans.id, schema.billingPlanVersions.planId))
        .where(and(eq(schema.billingPlans.code, "starter"), eq(schema.billingPlans.isActive, true)))
        .orderBy(desc(schema.billingPlanVersions.version))
        .limit(1)
    )[0];
    if (!starter) throw new Error("Starter billing plan is not configured");

    const now = new Date();
    const subscription = (
      await tx
        .insert(schema.billingSubscriptions)
        .values({
          billingAccountId: account.id,
          organizationId,
          planVersionId: starter.planVersionId,
          status: "active",
          currentPeriodStart: now,
          currentPeriodEnd: addMonths(now, 1),
        })
        .returning({ id: schema.billingSubscriptions.id })
    )[0];
    if (!subscription) throw new Error("Could not initialize subscription");

    await tx.insert(schema.billingSubscriptionChanges).values({
      organizationId,
      subscriptionId: subscription.id,
      toPlanVersionId: starter.planVersionId,
      toStatus: "active",
      kind: "activation",
      metadata: { source: "workspace_bootstrap" },
    });

    await tx.insert(schema.workspaceAuditLogs).values({
      organizationId,
      action: billingAuditActions.subscriptionActivated,
      targetType: "subscription",
      targetId: subscription.id,
      metadata: { source: "workspace_bootstrap" },
    });
  });
}

export function createBillingAdminService(db: BillingDb) {
  return {
    async createCustomPlan(input: {
      organizationId: string;
      name: string;
      code?: string;
      actorUserId?: string | null;
      entitlements: Partial<Record<EntitlementKey, number | null>>;
    }) {
      const code = input.code?.trim() || `${slugPart(input.name)}-${input.organizationId.slice(0, 8)}-${crypto.randomUUID().slice(0, 6)}`;
      const result = await db.transaction(async (tx) => {
        const plan = (
          await tx
            .insert(schema.billingPlans)
            .values({
              organizationId: input.organizationId,
              code,
              name: input.name,
              isCustom: true,
              isActive: true,
            })
            .returning()
        )[0];
        if (!plan) throw new Error("Could not create custom plan");

        const version = (
          await tx
            .insert(schema.billingPlanVersions)
            .values({ planId: plan.id, version: 1, interval: "custom", currency: "USD" })
            .returning()
        )[0];
        if (!version) throw new Error("Could not create custom plan version");

        const entries = Object.entries(input.entitlements) as Array<[EntitlementKey, number | null | undefined]>;
        const values = entries
          .filter((entry): entry is [EntitlementKey, number | null] => entry[1] !== undefined)
          .map(([key, limitValue]) => ({ planVersionId: version.id, key, limitValue }));
        if (values.length) await tx.insert(schema.billingPlanEntitlements).values(values);

        return { plan, version };
      });

      await audit(db, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId ?? null,
        action: billingAuditActions.manualOverride,
        targetType: "plan",
        targetId: result.plan.id,
        metadata: { operation: "custom_plan_created", code: result.plan.code },
      });
      return result;
    },

    async activateManualSubscription(input: {
      organizationId: string;
      planVersionId: string;
      periodStart: Date;
      periodEnd: Date;
      actorUserId?: string | null;
      status?: Extract<BillingSubscriptionStatus, "trialing" | "active" | "grace_period">;
      trialEndsAt?: Date | null;
      graceEndsAt?: Date | null;
    }) {
      const account = await billingAccountFor(db, input.organizationId);
      const current = await currentSubscription(db, input.organizationId);
      const nextStatus = input.status ?? "active";

      const subscription = current
        ? (
            await db
              .update(schema.billingSubscriptions)
              .set({
                planVersionId: input.planVersionId,
                status: nextStatus,
                isManual: true,
                providerKey: null,
                providerSubscriptionId: null,
                currentPeriodStart: input.periodStart,
                currentPeriodEnd: input.periodEnd,
                trialEndsAt: input.trialEndsAt ?? null,
                graceEndsAt: input.graceEndsAt ?? null,
                cancelledAt: null,
                suspendedAt: null,
                updatedAt: new Date(),
              })
              .where(and(eq(schema.billingSubscriptions.id, current.id), eq(schema.billingSubscriptions.organizationId, input.organizationId)))
              .returning()
          )[0]
        : (
            await db
              .insert(schema.billingSubscriptions)
              .values({
                billingAccountId: account.id,
                organizationId: input.organizationId,
                planVersionId: input.planVersionId,
                status: nextStatus,
                isManual: true,
                currentPeriodStart: input.periodStart,
                currentPeriodEnd: input.periodEnd,
                trialEndsAt: input.trialEndsAt ?? null,
                graceEndsAt: input.graceEndsAt ?? null,
              })
              .returning()
          )[0];
      if (!subscription) throw new Error("Could not activate manual subscription");

      await db.insert(schema.billingSubscriptionChanges).values({
        organizationId: input.organizationId,
        subscriptionId: subscription.id,
        fromPlanVersionId: current?.planVersionId ?? null,
        toPlanVersionId: input.planVersionId,
        fromStatus: current?.status ?? null,
        toStatus: nextStatus,
        kind: "manual_activation",
        actorUserId: input.actorUserId ?? null,
      });

      await audit(db, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId ?? null,
        action: billingAuditActions.subscriptionActivated,
        targetType: "subscription",
        targetId: subscription.id,
        metadata: { manual: true },
      });
      await audit(db, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId ?? null,
        action: billingAuditActions.manualOverride,
        targetType: "subscription",
        targetId: subscription.id,
        metadata: { operation: "manual_subscription" },
      });
      return subscription;
    },

    async changePlan(input: {
      organizationId: string;
      subscriptionId: string;
      planVersionId: string;
      actorUserId?: string | null;
    }) {
      const current = (
        await db
          .select()
          .from(schema.billingSubscriptions)
          .where(and(eq(schema.billingSubscriptions.id, input.subscriptionId), eq(schema.billingSubscriptions.organizationId, input.organizationId)))
          .limit(1)
      )[0];
      if (!current) throw new Error("Subscription not found");

      const updated = (
        await db
          .update(schema.billingSubscriptions)
          .set({ planVersionId: input.planVersionId, updatedAt: new Date() })
          .where(and(eq(schema.billingSubscriptions.id, input.subscriptionId), eq(schema.billingSubscriptions.organizationId, input.organizationId)))
          .returning()
      )[0];
      if (!updated) throw new Error("Could not change subscription plan");

      await db.insert(schema.billingSubscriptionChanges).values({
        organizationId: input.organizationId,
        subscriptionId: input.subscriptionId,
        fromPlanVersionId: current.planVersionId,
        toPlanVersionId: input.planVersionId,
        fromStatus: current.status,
        toStatus: current.status,
        kind: "plan_change",
        actorUserId: input.actorUserId ?? null,
      });
      await audit(db, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId ?? null,
        action: billingAuditActions.planChanged,
        targetType: "subscription",
        targetId: input.subscriptionId,
        metadata: { fromPlanVersionId: current.planVersionId, toPlanVersionId: input.planVersionId },
      });
      return updated;
    },

    async cancelSubscription(input: {
      organizationId: string;
      subscriptionId: string;
      actorUserId?: string | null;
    }) {
      const current = (
        await db
          .select()
          .from(schema.billingSubscriptions)
          .where(and(eq(schema.billingSubscriptions.id, input.subscriptionId), eq(schema.billingSubscriptions.organizationId, input.organizationId)))
          .limit(1)
      )[0];
      if (!current) throw new Error("Subscription not found");

      const updated = (
        await db
          .update(schema.billingSubscriptions)
          .set({ status: "cancelled", cancelledAt: new Date(), cancelAtPeriodEnd: false, updatedAt: new Date() })
          .where(and(eq(schema.billingSubscriptions.id, input.subscriptionId), eq(schema.billingSubscriptions.organizationId, input.organizationId)))
          .returning()
      )[0];
      if (!updated) throw new Error("Could not cancel subscription");

      await db.insert(schema.billingSubscriptionChanges).values({
        organizationId: input.organizationId,
        subscriptionId: input.subscriptionId,
        fromPlanVersionId: current.planVersionId,
        toPlanVersionId: current.planVersionId,
        fromStatus: current.status,
        toStatus: "cancelled",
        kind: "cancellation",
        actorUserId: input.actorUserId ?? null,
      });
      await audit(db, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId ?? null,
        action: billingAuditActions.subscriptionCancelled,
        targetType: "subscription",
        targetId: input.subscriptionId,
        metadata: {},
      });
      return updated;
    },

    async suspendSubscription(input: {
      organizationId: string;
      subscriptionId: string;
      actorUserId?: string | null;
      reason?: string;
    }) {
      const current = (
        await db
          .select()
          .from(schema.billingSubscriptions)
          .where(and(eq(schema.billingSubscriptions.id, input.subscriptionId), eq(schema.billingSubscriptions.organizationId, input.organizationId)))
          .limit(1)
      )[0];
      if (!current) throw new Error("Subscription not found");

      const updated = (
        await db
          .update(schema.billingSubscriptions)
          .set({ status: "suspended", suspendedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(schema.billingSubscriptions.id, input.subscriptionId), eq(schema.billingSubscriptions.organizationId, input.organizationId)))
          .returning()
      )[0];
      if (!updated) throw new Error("Could not suspend subscription");

      await db.insert(schema.billingSubscriptionChanges).values({
        organizationId: input.organizationId,
        subscriptionId: input.subscriptionId,
        fromPlanVersionId: current.planVersionId,
        toPlanVersionId: current.planVersionId,
        fromStatus: current.status,
        toStatus: "suspended",
        kind: "suspension",
        actorUserId: input.actorUserId ?? null,
        metadata: input.reason ? { reason: input.reason } : {},
      });
      await audit(db, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId ?? null,
        action: billingAuditActions.subscriptionSuspended,
        targetType: "subscription",
        targetId: input.subscriptionId,
        metadata: input.reason ? { reason: input.reason } : {},
      });
      return updated;
    },

    async createManualInvoice(input: {
      organizationId: string;
      subscriptionId?: string | null;
      invoiceNumber?: string | null;
      currency: string;
      amountMinor: number;
      dueAt?: Date | null;
      actorUserId?: string | null;
      metadata?: Record<string, unknown>;
    }) {
      const account = await billingAccountFor(db, input.organizationId);
      const invoice = (
        await db
          .insert(schema.billingInvoices)
          .values({
            organizationId: input.organizationId,
            billingAccountId: account.id,
            subscriptionId: input.subscriptionId ?? null,
            invoiceNumber: input.invoiceNumber ?? null,
            status: "open",
            currency: input.currency,
            subtotalMinor: input.amountMinor,
            totalMinor: input.amountMinor,
            amountDueMinor: input.amountMinor,
            dueAt: input.dueAt ?? null,
            metadata: input.metadata ?? {},
          })
          .returning()
      )[0];
      if (!invoice) throw new Error("Could not create manual invoice");

      await audit(db, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId ?? null,
        action: billingAuditActions.manualOverride,
        targetType: "invoice",
        targetId: invoice.id,
        metadata: { operation: "manual_invoice" },
      });
      return invoice;
    },

    async recordManualPayment(input: {
      organizationId: string;
      invoiceId: string;
      amountMinor: number;
      currency: string;
      paidAt?: Date;
      actorUserId?: string | null;
      metadata?: Record<string, unknown>;
    }) {
      const invoice = (
        await db
          .select()
          .from(schema.billingInvoices)
          .where(and(eq(schema.billingInvoices.id, input.invoiceId), eq(schema.billingInvoices.organizationId, input.organizationId)))
          .limit(1)
      )[0];
      if (!invoice) throw new Error("Invoice not found");

      const paidAt = input.paidAt ?? new Date();
      const payment = (
        await db
          .insert(schema.billingPayments)
          .values({
            organizationId: input.organizationId,
            invoiceId: input.invoiceId,
            status: "succeeded",
            currency: input.currency,
            amountMinor: input.amountMinor,
            paidAt,
            metadata: input.metadata ?? {},
          })
          .returning()
      )[0];
      if (!payment) throw new Error("Could not record manual payment");

      const amountPaidMinor = Math.min(invoice.totalMinor, invoice.amountPaidMinor + input.amountMinor);
      await db
        .update(schema.billingInvoices)
        .set({
          amountPaidMinor,
          amountDueMinor: Math.max(0, invoice.totalMinor - amountPaidMinor),
          status: amountPaidMinor >= invoice.totalMinor ? "paid" : invoice.status,
          paidAt: amountPaidMinor >= invoice.totalMinor ? paidAt : invoice.paidAt,
          updatedAt: new Date(),
        })
        .where(and(eq(schema.billingInvoices.id, input.invoiceId), eq(schema.billingInvoices.organizationId, input.organizationId)));

      await audit(db, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId ?? null,
        action: billingAuditActions.manualOverride,
        targetType: "payment",
        targetId: payment.id,
        metadata: { operation: "manual_payment", invoiceId: input.invoiceId },
      });
      return payment;
    },
  };
}
