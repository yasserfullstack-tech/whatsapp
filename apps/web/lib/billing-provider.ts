import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  StripeBillingProvider,
  createStripeWebhookService,
  type StripePriceRefs,
} from "@wa/billing";
import { schema } from "@wa/db";
import { db } from "./server";

export type OnlineBillingPlanCode = "growth" | "scale";

const STRIPE_CHECKOUT_ATTEMPT_TTL_MS = 45 * 60_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for online billing`);
  return value;
}

function appUrl(): string {
  return (process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "").replace(/\/$/, "") || requiredEnv("APP_URL");
}

export function getStripePriceRefs(): StripePriceRefs {
  return {
    growth: process.env.STRIPE_PRICE_GROWTH?.trim() || undefined,
    scale: process.env.STRIPE_PRICE_SCALE?.trim() || undefined,
  };
}

export function getOnlineBillingPlanOptions() {
  const refs = getStripePriceRefs();
  return (["growth", "scale"] as const).map((code) => ({ code, configured: Boolean(refs[code]) }));
}

export function isStripeBillingConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}

export function getStripeBillingProvider(requireWebhookSecret = false): StripeBillingProvider {
  const webhookSecret = requireWebhookSecret
    ? requiredEnv("STRIPE_WEBHOOK_SECRET")
    : process.env.STRIPE_WEBHOOK_SECRET?.trim();
  return new StripeBillingProvider({
    secretKey: requiredEnv("STRIPE_SECRET_KEY"),
    ...(webhookSecret ? { webhookSecret } : {}),
  });
}

export function getStripeWebhookProcessor() {
  const graceDaysRaw = process.env.BILLING_FAILED_PAYMENT_GRACE_DAYS;
  const graceDays = graceDaysRaw ? Number.parseInt(graceDaysRaw, 10) : 7;
  if (!Number.isFinite(graceDays) || graceDays < 0) {
    throw new Error("BILLING_FAILED_PAYMENT_GRACE_DAYS must be zero or a positive integer");
  }
  const provider = getStripeBillingProvider();
  return createStripeWebhookService(db, {
    priceRefs: getStripePriceRefs(),
    failedPaymentGraceDays: graceDays,
    retrieveSubscription: (subscriptionExternalId) => provider.retrieveSubscription(subscriptionExternalId),
    retrieveInvoice: (invoiceExternalId) => provider.retrieveInvoice(invoiceExternalId),
  });
}

async function billingAccount(organizationId: string) {
  const account = (
    await db
      .select()
      .from(schema.billingAccounts)
      .where(eq(schema.billingAccounts.organizationId, organizationId))
      .limit(1)
  )[0];
  if (!account) throw new Error("Billing account is not initialized");
  return account;
}

async function currentSubscription(organizationId: string) {
  return (
    await db
      .select()
      .from(schema.billingSubscriptions)
      .where(eq(schema.billingSubscriptions.organizationId, organizationId))
      .orderBy(desc(schema.billingSubscriptions.createdAt))
      .limit(1)
  )[0] ?? null;
}

async function reserveStripeCheckoutAttempt(
  organizationId: string,
  planCode: OnlineBillingPlanCode,
): Promise<{ idempotencyKey: string; expiresAt: Date }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      select ${schema.billingAccounts.id}
      from ${schema.billingAccounts}
      where ${schema.billingAccounts.organizationId} = ${organizationId}
      for update
    `);
    const account = (
      await tx
        .select({ id: schema.billingAccounts.id, metadata: schema.billingAccounts.metadata })
        .from(schema.billingAccounts)
        .where(eq(schema.billingAccounts.organizationId, organizationId))
        .limit(1)
    )[0];
    if (!account) throw new Error("Billing account is not initialized");

    const metadata = asRecord(account.metadata) ?? {};
    const current = asRecord(metadata.stripeCheckoutAttempt);
    const currentKey = typeof current?.key === "string" ? current.key : null;
    const currentPlan = typeof current?.planCode === "string" ? current.planCode : null;
    const currentExpiresAt = typeof current?.expiresAt === "string" ? new Date(current.expiresAt) : null;
    const now = new Date();

    if (currentKey && currentExpiresAt && Number.isFinite(currentExpiresAt.getTime()) && currentExpiresAt > now) {
      if (currentPlan !== planCode) {
        throw new Error("A Stripe Checkout session is already in progress for another plan");
      }
      return { idempotencyKey: currentKey, expiresAt: currentExpiresAt };
    }

    const expiresAt = new Date(now.getTime() + STRIPE_CHECKOUT_ATTEMPT_TTL_MS);
    const attempt = {
      key: randomUUID(),
      planCode,
      expiresAt: expiresAt.toISOString(),
    };
    await tx
      .update(schema.billingAccounts)
      .set({
        metadata: { ...metadata, stripeCheckoutAttempt: attempt },
        updatedAt: now,
      })
      .where(eq(schema.billingAccounts.id, account.id));
    return { idempotencyKey: attempt.key, expiresAt };
  });
}

async function ensureStripeCustomer(input: {
  organizationId: string;
  email?: string;
  name?: string;
}): Promise<string> {
  const account = await billingAccount(input.organizationId);
  if (account.providerKey && account.providerKey !== "stripe") {
    throw new Error(`Billing account is already linked to provider ${account.providerKey}`);
  }
  if (account.providerKey === "stripe" && account.providerCustomerId) return account.providerCustomerId;

  const provider = getStripeBillingProvider();
  const customer = await provider.createCustomer({
    organizationId: input.organizationId,
    ...(input.email ? { email: input.email } : {}),
    ...(input.name ? { name: input.name } : {}),
  });
  await db
    .update(schema.billingAccounts)
    .set({
      providerKey: "stripe",
      providerCustomerId: customer.externalId,
      billingEmail: input.email ?? account.billingEmail,
      updatedAt: new Date(),
    })
    .where(eq(schema.billingAccounts.id, account.id));
  return customer.externalId;
}

function priceRefFor(code: OnlineBillingPlanCode): string {
  const priceRef = getStripePriceRefs()[code];
  if (!priceRef) throw new Error(`Stripe Price ID for ${code} is not configured`);
  return priceRef;
}

async function activePlanVersion(code: OnlineBillingPlanCode) {
  const row = (
    await db
      .select({
        id: schema.billingPlanVersions.id,
        providerPriceRef: schema.billingPlanVersions.providerPriceRef,
      })
      .from(schema.billingPlanVersions)
      .innerJoin(schema.billingPlans, eq(schema.billingPlans.id, schema.billingPlanVersions.planId))
      .where(and(eq(schema.billingPlans.code, code), eq(schema.billingPlans.isActive, true)))
      .orderBy(desc(schema.billingPlanVersions.version))
      .limit(1)
  )[0];
  if (!row) throw new Error(`Billing plan ${code} is not configured`);
  return row;
}

export async function requestOnlinePlanChange(input: {
  organizationId: string;
  userEmail?: string;
  organizationName?: string;
  planCode: OnlineBillingPlanCode;
}): Promise<{ kind: "checkout"; url: string } | { kind: "changed" }> {
  const planVersion = await activePlanVersion(input.planCode);
  const priceRef = priceRefFor(input.planCode);
  if (planVersion.providerPriceRef && planVersion.providerPriceRef !== priceRef) {
    throw new Error(`Billing plan ${input.planCode} is already bound to a different Stripe Price; create a new plan version before changing price configuration`);
  }

  const subscription = await currentSubscription(input.organizationId);
  if (subscription?.isManual) throw new Error("Manual subscriptions must be changed by a platform administrator");

  const provider = getStripeBillingProvider();
  if (subscription?.providerKey === "stripe" && subscription.providerSubscriptionId && subscription.status !== "cancelled") {
    await provider.changePlan({
      subscriptionExternalId: subscription.providerSubscriptionId,
      planExternalRef: priceRef,
    });
    return { kind: "changed" };
  }

  const customerExternalId = await ensureStripeCustomer({
    organizationId: input.organizationId,
    ...(input.userEmail ? { email: input.userEmail } : {}),
    ...(input.organizationName ? { name: input.organizationName } : {}),
  });
  const checkoutAttempt = await reserveStripeCheckoutAttempt(input.organizationId, input.planCode);
  const root = appUrl();
  const checkout = await provider.createCheckout({
    organizationId: input.organizationId,
    customerExternalId,
    planExternalRef: priceRef,
    successUrl: `${root}/settings/billing?billing=checkout-complete`,
    cancelUrl: `${root}/settings/billing?billing=checkout-cancelled`,
    idempotencyKey: checkoutAttempt.idempotencyKey,
    expiresAt: checkoutAttempt.expiresAt,
    metadata: {
      planCode: input.planCode,
      checkoutAttemptKey: checkoutAttempt.idempotencyKey,
    },
  });
  return { kind: "checkout", url: checkout.url };
}

export async function createBillingPortalUrl(organizationId: string): Promise<string> {
  const account = await billingAccount(organizationId);
  if (account.providerKey !== "stripe" || !account.providerCustomerId) {
    throw new Error("No Stripe billing customer is linked to this workspace");
  }
  const portal = await getStripeBillingProvider().createBillingPortal({
    customerExternalId: account.providerCustomerId,
    returnUrl: `${appUrl()}/settings/billing`,
  });
  return portal.url;
}

export async function scheduleOnlineSubscriptionCancellation(organizationId: string): Promise<void> {
  const subscription = await currentSubscription(organizationId);
  if (!subscription || subscription.providerKey !== "stripe" || !subscription.providerSubscriptionId) {
    throw new Error("No Stripe subscription is linked to this workspace");
  }
  await getStripeBillingProvider().cancelSubscription({
    subscriptionExternalId: subscription.providerSubscriptionId,
    atPeriodEnd: true,
  });
}
