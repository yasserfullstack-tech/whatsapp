import { and, eq } from "drizzle-orm";
import { schema } from "@wa/db";
import type { BillingSubscriptionStatus } from "../entitlements";
import {
  auditBillingAction,
  billingAccountFor,
  billingAuditActions,
  type BillingDb,
  currentSubscription,
} from "./shared";

export function createSubscriptionAdminService(db: BillingDb) {
  return {
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

      await auditBillingAction(db, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId ?? null,
        action: billingAuditActions.subscriptionActivated,
        targetType: "subscription",
        targetId: subscription.id,
        metadata: { manual: true },
      });
      await auditBillingAction(db, {
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
      await auditBillingAction(db, {
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
      await auditBillingAction(db, {
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
      await auditBillingAction(db, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId ?? null,
        action: billingAuditActions.subscriptionSuspended,
        targetType: "subscription",
        targetId: input.subscriptionId,
        metadata: input.reason ? { reason: input.reason } : {},
      });
      return updated;
    },
  };
}
