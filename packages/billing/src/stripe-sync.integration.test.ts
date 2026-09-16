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
      const service = createStripeWebhookService(db, {
        priceRefs: { growth: growthPrice, scale: scalePrice },
        failedPaymentGraceDays: 7,
        now: () => now,
      });

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

      await service.process(stripeEvent(eventIds[0]!, "customer.subscription.created", subscriptionObject("active", growthPrice)));

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
      const failedResult = await service.process(stripeEvent(eventIds[1]!, "invoice.payment_failed", failedInvoice));
      expect(failedResult).toEqual({ processed: true, replay: false });

      subscription = (
        await db.select().from(schema.billingSubscriptions).where(eq(schema.billingSubscriptions.id, localSubscription.id)).limit(1)
      )[0];
      expect(subscription?.status).toBe("grace_period");
      expect(subscription?.graceEndsAt?.toISOString()).toBe("2026-09-23T10:00:00.000Z");

      const replay = await service.process(stripeEvent(eventIds[1]!, "invoice.payment_failed", failedInvoice));
      expect(replay).toEqual({ processed: false, replay: true });
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

      await service.process(stripeEvent(eventIds[2]!, "invoice.payment_succeeded", {
        ...failedInvoice,
        status: "paid",
        amount_due: 0,
        amount_paid: 1000,
        status_transitions: { paid_at: 1_789_552_800 },
      }));
      subscription = (
        await db.select().from(schema.billingSubscriptions).where(eq(schema.billingSubscriptions.id, localSubscription.id)).limit(1)
      )[0];
      expect(subscription?.status).toBe("active");
      expect(subscription?.graceEndsAt).toBeNull();
      const payment = (
        await db.select().from(schema.billingPayments).where(eq(schema.billingPayments.providerPaymentId, paymentId)).limit(1)
      )[0];
      expect(payment).toMatchObject({ status: "succeeded", amountMinor: 1000, refundedAmountMinor: 0 });

      await service.process(stripeEvent(eventIds[3]!, "customer.subscription.updated", subscriptionObject("active", scalePrice)));
      subscription = (
        await db.select().from(schema.billingSubscriptions).where(eq(schema.billingSubscriptions.id, localSubscription.id)).limit(1)
      )[0];
      expect(subscription?.planVersionId).toBe(scale.id);

      await service.process(stripeEvent(eventIds[4]!, "customer.subscription.updated", subscriptionObject("active", scalePrice, true)));
      subscription = (
        await db.select().from(schema.billingSubscriptions).where(eq(schema.billingSubscriptions.id, localSubscription.id)).limit(1)
      )[0];
      expect(subscription?.cancelAtPeriodEnd).toBe(true);

      await service.process(stripeEvent(eventIds[5]!, "refund.updated", {
        id: `re_${suffix}`,
        payment_intent: paymentId,
        amount: 1000,
      }));
      const refundedPayment = (
        await db.select().from(schema.billingPayments).where(eq(schema.billingPayments.providerPaymentId, paymentId)).limit(1)
      )[0];
      expect(refundedPayment).toMatchObject({ status: "refunded", refundedAmountMinor: 1000 });

      await service.process(stripeEvent(eventIds[6]!, "customer.subscription.deleted", subscriptionObject("canceled", scalePrice, false)));
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
