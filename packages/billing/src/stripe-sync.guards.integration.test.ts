import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, test } from "bun:test";
import { and, desc, eq, inArray } from "drizzle-orm";
import { createDatabase, schema } from "@wa/db";
import type { BillingProviderWebhookEvent } from "./provider";
import { createStripeWebhookService } from "./stripe-sync";

/**
 * Focused integration coverage for the individual Stripe billing hardening
 * guards that the lifecycle smoke test in `stripe-sync.integration.test.ts`
 * does not exercise. Each test drives the real webhook service against a real
 * Postgres database and is written so that removing its guard makes the test
 * fail (mutation-verified on the demo VPS).
 */

type StripeObject = Record<string, unknown>;
type BillingDb = ReturnType<typeof createDatabase>["db"];

const databaseUrl = process.env.DATABASE_URL;
const database = databaseUrl ? createDatabase(databaseUrl) : null;
const db: BillingDb | null = database?.db ?? null;

afterAll(async () => {
  await database?.client.end();
});

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

async function createOrganization(db: BillingDb, suffix: string, account: {
  providerKey?: string | null;
  providerCustomerId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const [organization] = await db
    .insert(schema.organizations)
    .values({ name: `Stripe guard ${suffix}`, slug: `stripe-guard-${suffix}` })
    .returning();
  if (!organization) throw new Error("Failed to create organization fixture");
  const [billingAccount] = await db
    .insert(schema.billingAccounts)
    .values({
      organizationId: organization.id,
      providerKey: account.providerKey ?? null,
      providerCustomerId: account.providerCustomerId ?? null,
      ...(account.metadata ? { metadata: account.metadata } : {}),
    })
    .returning();
  if (!billingAccount) throw new Error("Failed to create billing account fixture");
  return { organization, billingAccount };
}

async function configureGrowthPrice(db: BillingDb, price: string) {
  const row = (
    await db
      .select({
        id: schema.billingPlanVersions.id,
        providerPriceRef: schema.billingPlanVersions.providerPriceRef,
      })
      .from(schema.billingPlanVersions)
      .innerJoin(schema.billingPlans, eq(schema.billingPlans.id, schema.billingPlanVersions.planId))
      .where(and(eq(schema.billingPlans.code, "growth"), eq(schema.billingPlans.isActive, true)))
      .orderBy(desc(schema.billingPlanVersions.version))
      .limit(1)
  )[0];
  if (!row) throw new Error("Seeded growth billing plan is missing");
  await db
    .update(schema.billingPlanVersions)
    .set({ providerPriceRef: price })
    .where(eq(schema.billingPlanVersions.id, row.id));
  return { id: row.id, original: row.providerPriceRef };
}

async function restorePlanPrice(db: BillingDb, id: string, original: string | null) {
  await db
    .update(schema.billingPlanVersions)
    .set({ providerPriceRef: original })
    .where(eq(schema.billingPlanVersions.id, id));
}

async function cleanup(db: BillingDb, organizationId: string | null, eventIds: string[]) {
  if (organizationId) {
    await db.delete(schema.organizations).where(eq(schema.organizations.id, organizationId));
  }
  if (eventIds.length) {
    await db.delete(schema.billingProviderEvents).where(inArray(schema.billingProviderEvents.externalEventId, eventIds));
  }
}

describe("Stripe webhook hardening guards", () => {
  test("rejects a Checkout completion for a billing account already linked to a foreign provider", async () => {
    if (!db) return;
    const suffix = randomUUID();
    const eventId = `evt_foreign_account_${suffix}`;
    const customerId = `cus_foreign_${suffix}`;
    let organizationId: string | null = null;
    try {
      const { organization } = await createOrganization(db, suffix, { providerKey: "paddle" });
      organizationId = organization.id;

      const service = createStripeWebhookService(db, { priceRefs: {} });
      await expect(
        service.process(stripeEvent(eventId, "checkout.session.completed", {
          id: `cs_${suffix}`,
          customer: customerId,
          metadata: { organizationId: organization.id },
        })),
      ).rejects.toThrow("Billing account is already linked to provider paddle");
    } finally {
      await cleanup(db, organizationId, [eventId]);
    }
  });

  test("rejects a Checkout completion whose Stripe customer does not match the workspace billing account", async () => {
    if (!db) return;
    const suffix = randomUUID();
    const eventId = `evt_customer_mismatch_${suffix}`;
    const boundCustomerId = `cus_bound_${suffix}`;
    let organizationId: string | null = null;
    try {
      const { organization } = await createOrganization(db, suffix, {
        providerKey: "stripe",
        providerCustomerId: boundCustomerId,
      });
      organizationId = organization.id;

      const service = createStripeWebhookService(db, { priceRefs: {} });
      await expect(
        service.process(stripeEvent(eventId, "checkout.session.completed", {
          id: `cs_${suffix}`,
          customer: `cus_other_${suffix}`,
          metadata: { organizationId: organization.id },
        })),
      ).rejects.toThrow("Stripe customer does not match the workspace billing account");
    } finally {
      await cleanup(db, organizationId, [eventId]);
    }
  });

  test("rejects a Stripe subscription event for a workspace that already has an active foreign-provider subscription", async () => {
    if (!db) return;
    const suffix = randomUUID();
    const eventId = `evt_foreign_subscription_${suffix}`;
    const customerId = `cus_${suffix}`;
    const growthPrice = `price_growth_${suffix}`;
    const providerSubscriptionId = `sub_stripe_${suffix}`;
    let organizationId: string | null = null;
    let growthVersionId: string | null = null;
    let originalGrowthPrice: string | null = null;
    try {
      const { organization, billingAccount } = await createOrganization(db, suffix, {
        providerKey: "stripe",
        providerCustomerId: customerId,
      });
      organizationId = organization.id;

      const growth = await configureGrowthPrice(db, growthPrice);
      growthVersionId = growth.id;
      originalGrowthPrice = growth.original;

      await db.insert(schema.billingSubscriptions).values({
        organizationId: organization.id,
        billingAccountId: billingAccount.id,
        planVersionId: growth.id,
        providerKey: "paddle",
        providerSubscriptionId: `sub_paddle_${suffix}`,
        status: "active",
        currentPeriodStart: new Date("2026-09-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-10-01T00:00:00.000Z"),
      });

      const service = createStripeWebhookService(db, { priceRefs: { growth: growthPrice } });
      await expect(
        service.process(stripeEvent(eventId, "customer.subscription.updated", {
          id: providerSubscriptionId,
          customer: customerId,
          status: "active",
          metadata: { organizationId: organization.id },
          items: { data: [{ id: `si_${suffix}`, price: growthPrice }] },
        })),
      ).rejects.toThrow("Workspace already has an active paddle subscription");
    } finally {
      if (growthVersionId) await restorePlanPrice(db, growthVersionId, originalGrowthPrice);
      await cleanup(db, organizationId, [eventId]);
    }
  });

  test("rejects a Stripe subscription event whose metadata claims a workspace other than the one that owns it", async () => {
    if (!db) return;
    const suffix = randomUUID();
    const eventId = `evt_cross_workspace_reject_${suffix}`;
    const growthPrice = `price_growth_${suffix}`;
    const providerSubscriptionId = `sub_owned_${suffix}`;
    const ownerCustomerId = `cus_owner_${suffix}`;
    let ownerOrganizationId: string | null = null;
    let otherOrganizationId: string | null = null;
    let growthVersionId: string | null = null;
    let originalGrowthPrice: string | null = null;
    try {
      const owner = await createOrganization(db, `${suffix}-owner`, {
        providerKey: "stripe",
        providerCustomerId: ownerCustomerId,
      });
      ownerOrganizationId = owner.organization.id;
      const other = await createOrganization(db, `${suffix}-other`, { providerKey: "stripe" });
      otherOrganizationId = other.organization.id;

      const growth = await configureGrowthPrice(db, growthPrice);
      growthVersionId = growth.id;
      originalGrowthPrice = growth.original;

      await db.insert(schema.billingSubscriptions).values({
        organizationId: owner.organization.id,
        billingAccountId: owner.billingAccount.id,
        planVersionId: growth.id,
        providerKey: "stripe",
        providerSubscriptionId,
        status: "active",
        currentPeriodStart: new Date("2026-09-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-10-01T00:00:00.000Z"),
      });

      const service = createStripeWebhookService(db, { priceRefs: { growth: growthPrice } });
      await expect(
        service.process(stripeEvent(eventId, "customer.subscription.updated", {
          id: providerSubscriptionId,
          customer: ownerCustomerId,
          status: "past_due",
          metadata: { organizationId: other.organization.id },
          items: { data: [{ id: `si_${suffix}`, price: growthPrice }] },
        })),
      ).rejects.toThrow("Stripe subscription is already linked to a different workspace");

      // The owning workspace keeps its state: "past_due" would have moved the
      // row to grace_period had the mis-routed event been applied.
      const owned = (
        await db
          .select()
          .from(schema.billingSubscriptions)
          .where(eq(schema.billingSubscriptions.providerSubscriptionId, providerSubscriptionId))
          .limit(1)
      )[0];
      expect(owned).toMatchObject({
        organizationId: owner.organization.id,
        providerKey: "stripe",
        providerSubscriptionId,
        status: "active",
        planVersionId: growth.id,
      });
      expect(owned?.graceEndsAt).toBeNull();
    } finally {
      if (growthVersionId) await restorePlanPrice(db, growthVersionId, originalGrowthPrice);
      await cleanup(db, ownerOrganizationId, [eventId]);
      await cleanup(db, otherOrganizationId, []);
    }
  });

  test("applies a Stripe subscription event when the metadata claim matches the owning workspace", async () => {
    if (!db) return;
    const suffix = randomUUID();
    const eventId = `evt_cross_workspace_apply_${suffix}`;
    const growthPrice = `price_growth_${suffix}`;
    const providerSubscriptionId = `sub_owned_${suffix}`;
    const ownerCustomerId = `cus_owner_${suffix}`;
    let ownerOrganizationId: string | null = null;
    let growthVersionId: string | null = null;
    let originalGrowthPrice: string | null = null;
    try {
      const owner = await createOrganization(db, `${suffix}-owner`, {
        providerKey: "stripe",
        providerCustomerId: ownerCustomerId,
      });
      ownerOrganizationId = owner.organization.id;

      const growth = await configureGrowthPrice(db, growthPrice);
      growthVersionId = growth.id;
      originalGrowthPrice = growth.original;

      await db.insert(schema.billingSubscriptions).values({
        organizationId: owner.organization.id,
        billingAccountId: owner.billingAccount.id,
        planVersionId: growth.id,
        providerKey: "stripe",
        providerSubscriptionId,
        status: "active",
        currentPeriodStart: new Date("2026-09-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-10-01T00:00:00.000Z"),
      });

      const service = createStripeWebhookService(db, { priceRefs: { growth: growthPrice } });
      await service.process(stripeEvent(eventId, "customer.subscription.updated", {
        id: providerSubscriptionId,
        customer: ownerCustomerId,
        status: "past_due",
        metadata: { organizationId: owner.organization.id },
        items: { data: [{ id: `si_${suffix}`, price: growthPrice }] },
      }));

      const owned = (
        await db
          .select()
          .from(schema.billingSubscriptions)
          .where(eq(schema.billingSubscriptions.providerSubscriptionId, providerSubscriptionId))
          .limit(1)
      )[0];
      expect(owned).toMatchObject({
        organizationId: owner.organization.id,
        providerKey: "stripe",
        status: "grace_period",
        planVersionId: growth.id,
      });
      expect(owned?.graceEndsAt).not.toBeNull();
    } finally {
      if (growthVersionId) await restorePlanPrice(db, growthVersionId, originalGrowthPrice);
      await cleanup(db, ownerOrganizationId, [eventId]);
    }
  });

  test("keeps a newer persisted Checkout attempt when an older delayed completion arrives", async () => {
    if (!db) return;
    const suffix = randomUUID();
    const eventId = `evt_stale_checkout_${suffix}`;
    const customerId = `cus_${suffix}`;
    const persistedAttempt = {
      key: `attempt_newer_${suffix}`,
      planCode: "growth",
      expiresAt: "2026-09-16T11:00:00.000Z",
    };
    let organizationId: string | null = null;
    try {
      const { organization, billingAccount } = await createOrganization(db, suffix, {
        providerKey: "stripe",
        providerCustomerId: customerId,
        metadata: { stripeCheckoutAttempt: persistedAttempt },
      });
      organizationId = organization.id;

      const service = createStripeWebhookService(db, { priceRefs: {} });
      await service.process(stripeEvent(eventId, "checkout.session.completed", {
        id: `cs_${suffix}`,
        customer: customerId,
        metadata: {
          organizationId: organization.id,
          checkoutAttemptKey: `attempt_older_${suffix}`,
        },
      }));

      const account = (
        await db.select().from(schema.billingAccounts).where(eq(schema.billingAccounts.id, billingAccount.id)).limit(1)
      )[0];
      const metadata = (account?.metadata ?? {}) as Record<string, unknown>;
      expect(metadata.stripeCheckoutAttempt).toEqual(persistedAttempt);
    } finally {
      await cleanup(db, organizationId, [eventId]);
    }
  });

  test("acknowledges an already-processed replay from the local ledger without calling the Stripe API", async () => {
    if (!db) return;
    const suffix = randomUUID();
    const eventId = `evt_ledger_replay_${suffix}`;
    const customerId = `cus_${suffix}`;
    const subscriptionId = `sub_${suffix}`;
    const growthPrice = `price_growth_${suffix}`;
    let organizationId: string | null = null;
    let growthVersionId: string | null = null;
    let originalGrowthPrice: string | null = null;
    try {
      const { organization, billingAccount } = await createOrganization(db, suffix, {
        providerKey: "stripe",
        providerCustomerId: customerId,
      });
      organizationId = organization.id;

      const growth = await configureGrowthPrice(db, growthPrice);
      growthVersionId = growth.id;
      originalGrowthPrice = growth.original;

      await db.insert(schema.billingSubscriptions).values({
        organizationId: organization.id,
        billingAccountId: billingAccount.id,
        planVersionId: growth.id,
        status: "active",
        currentPeriodStart: new Date("2026-09-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-10-01T00:00:00.000Z"),
      });

      const subscriptionObject: StripeObject = {
        id: subscriptionId,
        customer: customerId,
        status: "active",
        metadata: { organizationId: organization.id },
        items: { data: [{ id: `si_${suffix}`, price: growthPrice }] },
      };
      let providerCalls = 0;
      const service = createStripeWebhookService(db, {
        priceRefs: { growth: growthPrice },
        retrieveSubscription: async () => {
          providerCalls += 1;
          // The first event legitimately hydrates from Stripe; a replay must
          // never reach this call.
          if (providerCalls > 1) throw new Error("Stripe API must not be called for a processed replay");
          return subscriptionObject;
        },
      });

      const first = await service.process(stripeEvent(eventId, "customer.subscription.created", subscriptionObject));
      expect(first).toEqual({ processed: true, replay: false });
      expect(providerCalls).toBe(1);

      // The replay carries a payload that is not even re-parseable: the ledger
      // acknowledgement must happen before payload validation and hydration.
      const replay: BillingProviderWebhookEvent = {
        providerKey: "stripe",
        externalId: eventId,
        eventType: "customer.subscription.created",
        verified: true,
        payload: { id: eventId, type: "customer.subscription.created", data: {} },
      };
      await expect(service.process(replay)).resolves.toEqual({ processed: false, replay: true });
      expect(providerCalls).toBe(1);
    } finally {
      if (growthVersionId) await restorePlanPrice(db, growthVersionId, originalGrowthPrice);
      await cleanup(db, organizationId, [eventId]);
    }
  });

  test("ignores a refund event whose status is not succeeded", async () => {
    if (!db) return;
    const suffix = randomUUID();
    const eventId = `evt_refund_pending_${suffix}`;
    const paymentId = `pi_${suffix}`;
    let organizationId: string | null = null;
    try {
      const { organization } = await createOrganization(db, suffix, {});
      organizationId = organization.id;
      await db.insert(schema.billingPayments).values({
        organizationId: organization.id,
        providerKey: "stripe",
        providerPaymentId: paymentId,
        status: "succeeded",
        currency: "USD",
        amountMinor: 1000,
      });

      const service = createStripeWebhookService(db, { priceRefs: {} });
      await service.process(stripeEvent(eventId, "refund.created", {
        id: `re_pending_${suffix}`,
        payment_intent: paymentId,
        amount: 400,
        status: "pending",
      }));

      const payment = (
        await db.select().from(schema.billingPayments).where(eq(schema.billingPayments.providerPaymentId, paymentId)).limit(1)
      )[0];
      expect(payment).toMatchObject({ status: "succeeded", refundedAmountMinor: 0 });
      expect((payment?.metadata as Record<string, unknown> | null)?.stripeRefundAmounts).toBeUndefined();
    } finally {
      await cleanup(db, organizationId, [eventId]);
    }
  });

  test("leaves the payment untouched for a zero-amount refund", async () => {
    if (!db) return;
    const suffix = randomUUID();
    const eventId = `evt_refund_zero_${suffix}`;
    const paymentId = `pi_${suffix}`;
    let organizationId: string | null = null;
    try {
      const { organization } = await createOrganization(db, suffix, {});
      organizationId = organization.id;
      await db.insert(schema.billingPayments).values({
        organizationId: organization.id,
        providerKey: "stripe",
        providerPaymentId: paymentId,
        status: "succeeded",
        currency: "USD",
        amountMinor: 1000,
      });

      const service = createStripeWebhookService(db, { priceRefs: {} });
      await service.process(stripeEvent(eventId, "refund.created", {
        id: `re_zero_${suffix}`,
        payment_intent: paymentId,
        amount: 0,
        status: "succeeded",
      }));

      const payment = (
        await db.select().from(schema.billingPayments).where(eq(schema.billingPayments.providerPaymentId, paymentId)).limit(1)
      )[0];
      expect(payment).toMatchObject({ status: "succeeded", refundedAmountMinor: 0 });
      expect((payment?.metadata as Record<string, unknown> | null)?.stripeRefundAmounts).toBeUndefined();
    } finally {
      await cleanup(db, organizationId, [eventId]);
    }
  });
});
