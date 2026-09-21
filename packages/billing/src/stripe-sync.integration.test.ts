import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { createDatabase, schema } from "@wa/db";
import type { BillingProviderWebhookEvent } from "./provider";
import { createStripeWebhookService } from "./stripe-sync";

type StripeObject = Record<string, unknown>;

function stripeEvent(id: string, eventType: string, object: StripeObject): BillingProviderWebhookEvent {
  return {
    providerKey: "stripe",
    externalId: id,
    eventType,
    verified: true,
    payload: {
      id,
      type: eventType,
      created: 1_789_552_800,
      data: { object },
    },
  };
}

describe("Stripe webhook lifecycle integration", () => {
  test("synchronizes activation, failed payment, recovery, plan change, cancellation, refunds, and replays", async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) return;

    const database = createDatabase(databaseUrl);
    const db = database.db;
    const suffix = randomUUID();
    const eventIds = [
      `evt_activate_${suffix}`,
      `evt_failed_${suffix}`,
      `evt_paid_${suffix}`,
      `evt_upgrade_${suffix}`,
      `evt_cancel_schedule_${suffix}`,
      `evt_refund_${suffix}`,
      `evt_cancelled_${suffix}`,
      `evt_duplicate_subscription_${suffix}`,
      `evt_refund_second_${suffix}`,
      `evt_charge_refund_${suffix}`,
      `evt_refund_late_${suffix}`,
      `evt_failed_late_${suffix}`,
      `evt_subscription_late_${suffix}`,
      `evt_checkout_${suffix}`,
    ];
    const growthPrice = `price_growth_${suffix}`;
    const scalePrice = `price_scale_${suffix}`;
    const customerId = `cus_${suffix}`;
    const subscriptionId = `sub_${suffix}`;
    const invoiceId = `in_${suffix}`;
    const paymentId = `pi_${suffix}`;

    let organizationId: string | null = null;
    let growthVersionId: string | null = null;
    let scaleVersionId: string | null = null;
    let originalGrowthPrice: string | null = null;
    let originalScalePrice: string | null = null;

    try {
      const planVersions = await db
        .select({
          code: schema.billingPlans.code,
          id: schema.billingPlanVersions.id,
          providerPriceRef: schema.billingPlanVersions.providerPriceRef,
        })
        .from(schema.billingPlanVersions)
        .innerJoin(schema.billingPlans, eq(schema.billingPlans.id, schema.billingPlanVersions.planId))
        .where(inArray(schema.billingPlans.code, ["starter", "growth", "scale"]))
        .orderBy(desc(schema.billingPlanVersions.version));

      const starter = planVersions.find((row) => row.code === "starter");
      const growth = planVersions.find((row) => row.code === "growth");
      const scale = planVersions.find((row) => row.code === "scale");
      if (!starter || !growth || !scale) throw new Error("Seeded billing plans are missing");

      growthVersionId = growth.id;
      scaleVersionId = scale.id;
      originalGrowthPrice = growth.providerPriceRef;
      originalScalePrice = scale.providerPriceRef;

      await db.update(schema.billingPlanVersions).set({ providerPriceRef: growthPrice }).where(eq(schema.billingPlanVersions.id, growth.id));
      await db.update(schema.billingPlanVersions).set({ providerPriceRef: scalePrice }).where(eq(schema.billingPlanVersions.id, scale.id));

      const [organization] = await db.insert(schema.organizations).values({
        name: "Stripe Lifecycle Test",
        slug: `stripe-lifecycle-${suffix}`,
      }).returning();
      if (!organization) throw new Error("Failed to create organization fixture");
      organizationId = organization.id;

      const [account] = await db.insert(schema.billingAccounts).values({
        organizationId: organization.id,
        metadata: {
          stripeCheckoutAttempt: {
            key: `checkout_attempt_${suffix}`,
            planCode: "growth",
            expiresAt: "2026-09-16T11:00:00.000Z",
          },
        },
      }).returning();
      if (!account) throw new Error("Failed to create billing account fixture");

      const periodStart = new Date("2026-09-01T00:00:00.000Z");
      const periodEnd = new Date("2026-10-01T00:00:00.000Z");
      const [localSubscription] = await db.insert(schema.billingSubscriptions).values({
        organizationId: organization.id,
        billingAccountId: account.id,
        planVersionId: starter.id,
        status: "active",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      }).returning();
      if (!localSubscription) throw new Error("Failed to create subscription fixture");

      const now = new Date("2026-09-16T10:00:00.000Z");
      const subscriptionObject = (status: string, price: string, cancelAtPeriodEnd = false): StripeObject => ({
        id: subscriptionId,
        customer: customerId,
        status,
        metadata: { organizationId: organization.id },
        items: { data: [{ id: `si_${suffix}`, price, current_period_start: 1_788_220_800, current_period_end: 1_790_812_800 }] },
        current_period_start: 1_788_220_800,
        current_period_end: 1_790_812_800,
        cancel_at_period_end: cancelAtPeriodEnd,
      });
      const latestSubscriptions = new Map<string, StripeObject>();
      const latestInvoices = new Map<string, StripeObject>();
      const service = createStripeWebhookService(db, {
        priceRefs: { growth: growthPrice, scale: scalePrice },
        failedPaymentGraceDays: 7,
        now: () => now,
        retrieveSubscription: async (id) => {
          const value = latestSubscriptions.get(id);
          if (!value) throw new Error(`Missing provider subscription fixture ${id}`);
          return value;
        },
        retrieveInvoice: async (id) => {
          const value = latestInvoices.get(id);
          if (!value) throw new Error(`Missing provider invoice fixture ${id}`);
          return value;
        },
      });

      const initialSubscription = subscriptionObject("active", growthPrice);
      latestSubscriptions.set(subscriptionId, initialSubscription);
      await service.process(stripeEvent(eventIds[13]!, "checkout.session.completed", {
        id: `cs_${suffix}`,
        customer: customerId,
        subscription: subscriptionId,
        metadata: {
          organizationId: organization.id,
          checkoutAttemptKey: `checkout_attempt_${suffix}`,
        },
      }));
      const checkoutAccount = (
        await db.select().from(schema.billingAccounts).where(eq(schema.billingAccounts.id, account.id)).limit(1)
      )[0];
      expect((checkoutAccount?.metadata as Record<string, unknown> | null)?.stripeCheckoutAttempt).toBeUndefined();

      await service.process(stripeEvent(eventIds[0]!, "customer.subscription.created", initialSubscription));

      const duplicateSubscriptionId = `sub_duplicate_${suffix}`;
      const duplicateSubscription = {
        ...subscriptionObject("active", growthPrice),
        id: duplicateSubscriptionId,
      };
      latestSubscriptions.set(duplicateSubscriptionId, duplicateSubscription);
      await expect(service.process(stripeEvent(eventIds[7]!, "customer.subscription.created", duplicateSubscription)))
        .rejects.toThrow("Workspace already has a different active Stripe subscription");

      let subscription = (
        await db.select().from(schema.billingSubscriptions).where(eq(schema.billingSubscriptions.id, localSubscription.id)).limit(1)
      )[0];
      expect(subscription).toMatchObject({
        providerKey: "stripe",
        providerSubscriptionId: subscriptionId,
        planVersionId: growth.id,
        status: "active",
        isManual: false,
      });
      const linkedAccount = (
        await db.select().from(schema.billingAccounts).where(eq(schema.billingAccounts.id, account.id)).limit(1)
      )[0];
      expect(linkedAccount).toMatchObject({ providerKey: "stripe", providerCustomerId: customerId });
      const duplicateEvent = (
        await db
          .select({ processedAt: schema.billingProviderEvents.processedAt })
          .from(schema.billingProviderEvents)
          .where(eq(schema.billingProviderEvents.externalEventId, eventIds[7]!))
          .limit(1)
      )[0];
      expect(duplicateEvent?.processedAt).toBeNull();
      expect(subscription?.providerSubscriptionId).toBe(subscriptionId);

      const failedInvoice: StripeObject = {
        id: invoiceId,
        customer: customerId,
        subscription: subscriptionId,
        payment_intent: paymentId,
        number: `INV-${suffix}`,
        status: "open",
        currency: "usd",
        subtotal: 1000,
        total: 1000,
        amount_due: 1000,
        amount_paid: 0,
        period_start: 1_788_220_800,
        period_end: 1_790_812_800,
      };
      latestInvoices.set(invoiceId, failedInvoice);
      const failedResult = await service.process(stripeEvent(eventIds[1]!, "invoice.payment_failed", failedInvoice));
      expect(failedResult).toEqual({ processed: true, replay: false });

      subscription = (
        await db.select().from(schema.billingSubscriptions).where(eq(schema.billingSubscriptions.id, localSubscription.id)).limit(1)
      )[0];
      expect(subscription?.status).toBe("grace_period");
      expect(subscription?.graceEndsAt?.toISOString()).toBe("2026-09-23T10:00:00.000Z");

      latestInvoices.delete(invoiceId);
      const replay = await service.process(stripeEvent(eventIds[1]!, "invoice.payment_failed", failedInvoice));
      expect(replay).toEqual({ processed: false, replay: true });
      latestInvoices.set(invoiceId, failedInvoice);
      const eventCount = await db
        .select({ total: count() })
        .from(schema.billingProviderEvents)
        .where(and(
          eq(schema.billingProviderEvents.providerKey, "stripe"),
          eq(schema.billingProviderEvents.externalEventId, eventIds[1]!),
        ));
      expect(eventCount[0]?.total).toBe(1);
      const failedPaymentCount = await db
        .select({ total: count() })
        .from(schema.billingPayments)
        .where(and(
          eq(schema.billingPayments.providerKey, "stripe"),
          eq(schema.billingPayments.providerPaymentId, paymentId),
        ));
      expect(failedPaymentCount[0]?.total).toBe(1);

      const paidInvoice = {
        ...failedInvoice,
        status: "paid",
        amount_due: 0,
        amount_paid: 1000,
        status_transitions: { paid_at: 1_789_552_800 },
      };
      latestInvoices.set(invoiceId, paidInvoice);
      await service.process(stripeEvent(eventIds[2]!, "invoice.payment_succeeded", paidInvoice));
      subscription = (
        await db.select().from(schema.billingSubscriptions).where(eq(schema.billingSubscriptions.id, localSubscription.id)).limit(1)
      )[0];
      expect(subscription?.status).toBe("active");
      expect(subscription?.graceEndsAt).toBeNull();
      let payment = (
        await db.select().from(schema.billingPayments).where(eq(schema.billingPayments.providerPaymentId, paymentId)).limit(1)
      )[0];
      expect(payment).toMatchObject({ status: "succeeded", amountMinor: 1000, refundedAmountMinor: 0 });

      await service.process(stripeEvent(eventIds[11]!, "invoice.payment_failed", failedInvoice));
      subscription = (
        await db.select().from(schema.billingSubscriptions).where(eq(schema.billingSubscriptions.id, localSubscription.id)).limit(1)
      )[0];
      payment = (
        await db.select().from(schema.billingPayments).where(eq(schema.billingPayments.providerPaymentId, paymentId)).limit(1)
      )[0];
      expect(subscription?.status).toBe("active");
      expect(payment?.status).toBe("succeeded");

      const scaleSubscription = subscriptionObject("active", scalePrice);
      let hydrationCall = 0;
      let firstHydrationStartedResolve: (() => void) | null = null;
      const firstHydrationStarted = new Promise<void>((resolve) => {
        firstHydrationStartedResolve = resolve;
      });
      const concurrentService = createStripeWebhookService(db, {
        priceRefs: { growth: growthPrice, scale: scalePrice },
        failedPaymentGraceDays: 7,
        now: () => now,
        retrieveSubscription: async () => {
          hydrationCall += 1;
          if (hydrationCall === 1) {
            firstHydrationStartedResolve?.();
            await new Promise((resolve) => setTimeout(resolve, 100));
            return initialSubscription;
          }
          return scaleSubscription;
        },
      });

      const olderUpdate = concurrentService.process(
        stripeEvent(eventIds[12]!, "customer.subscription.updated", initialSubscription),
      );
      await firstHydrationStarted;
      const newerUpdate = concurrentService.process(
        stripeEvent(eventIds[3]!, "customer.subscription.updated", scaleSubscription),
      );
      await Promise.all([olderUpdate, newerUpdate]);
      expect(hydrationCall).toBe(2);
      subscription = (
        await db.select().from(schema.billingSubscriptions).where(eq(schema.billingSubscriptions.id, localSubscription.id)).limit(1)
      )[0];
      expect(subscription?.planVersionId).toBe(scale.id);
      latestSubscriptions.set(subscriptionId, scaleSubscription);

      const cancelScheduledSubscription = subscriptionObject("active", scalePrice, true);
      latestSubscriptions.set(subscriptionId, cancelScheduledSubscription);
      await service.process(stripeEvent(eventIds[4]!, "customer.subscription.updated", cancelScheduledSubscription));
      subscription = (
        await db.select().from(schema.billingSubscriptions).where(eq(schema.billingSubscriptions.id, localSubscription.id)).limit(1)
      )[0];
      expect(subscription?.cancelAtPeriodEnd).toBe(true);

      const firstRefundId = `re_first_${suffix}`;
      await Promise.all([
        service.process(stripeEvent(eventIds[5]!, "refund.created", {
          id: firstRefundId,
          payment_intent: paymentId,
          amount: 400,
          status: "succeeded",
        })),
        service.process(stripeEvent(eventIds[8]!, "refund.created", {
          id: `re_second_${suffix}`,
          payment_intent: paymentId,
          amount: 600,
          status: "succeeded",
        })),
      ]);
      let refundedPayment = (
        await db.select().from(schema.billingPayments).where(eq(schema.billingPayments.providerPaymentId, paymentId)).limit(1)
      )[0];
      expect(refundedPayment).toMatchObject({ status: "refunded", refundedAmountMinor: 1000 });

      await service.process(stripeEvent(eventIds[9]!, "charge.refunded", {
        id: `ch_${suffix}`,
        payment_intent: paymentId,
        amount_refunded: 1000,
      }));
      await service.process(stripeEvent(eventIds[10]!, "refund.updated", {
        id: firstRefundId,
        payment_intent: paymentId,
        amount: 400,
        status: "succeeded",
      }));
      refundedPayment = (
        await db.select().from(schema.billingPayments).where(eq(schema.billingPayments.providerPaymentId, paymentId)).limit(1)
      )[0];
      expect(refundedPayment).toMatchObject({ status: "refunded", refundedAmountMinor: 1000 });

      const cancelledSubscription = subscriptionObject("canceled", scalePrice, false);
      latestSubscriptions.set(subscriptionId, cancelledSubscription);
      await service.process(stripeEvent(eventIds[6]!, "customer.subscription.deleted", cancelledSubscription));
      subscription = (
        await db.select().from(schema.billingSubscriptions).where(eq(schema.billingSubscriptions.id, localSubscription.id)).limit(1)
      )[0];
      expect(subscription?.status).toBe("cancelled");

      const changes = await db
        .select({ kind: schema.billingSubscriptionChanges.kind })
        .from(schema.billingSubscriptionChanges)
        .where(eq(schema.billingSubscriptionChanges.subscriptionId, localSubscription.id));
      expect(changes.map((change) => change.kind)).toContain("plan_change");
      expect(changes.map((change) => change.kind)).toContain("cancellation");
    } finally {
      if (organizationId) {
        await db.delete(schema.organizations).where(eq(schema.organizations.id, organizationId));
      }
      if (eventIds.length) {
        await db.delete(schema.billingProviderEvents).where(inArray(schema.billingProviderEvents.externalEventId, eventIds));
      }
      if (growthVersionId) {
        await db.update(schema.billingPlanVersions).set({ providerPriceRef: originalGrowthPrice }).where(eq(schema.billingPlanVersions.id, growthVersionId));
      }
      if (scaleVersionId) {
        await db.update(schema.billingPlanVersions).set({ providerPriceRef: originalScalePrice }).where(eq(schema.billingPlanVersions.id, scaleVersionId));
      }
      await database.client.end();
    }
  });
});
