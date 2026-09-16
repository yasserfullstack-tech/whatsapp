import { and, desc, eq, sql } from "drizzle-orm";
import { createDatabase, schema } from "@wa/db";
import type { BillingProviderWebhookEvent } from "./provider";

type BillingDb = ReturnType<typeof createDatabase>["db"];
type BillingTransaction = Parameters<Parameters<BillingDb["transaction"]>[0]>[0];
type StripeObject = Record<string, unknown>;

export type StripePriceRefs = Record<string, string | undefined>;

export type StripeWebhookServiceOptions = {
  priceRefs: StripePriceRefs;
  failedPaymentGraceDays?: number;
  now?: () => Date;
};

export type StripeWebhookProcessResult = {
  processed: boolean;
  replay: boolean;
};

function asRecord(value: unknown): StripeObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as StripeObject : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function idFrom(value: unknown): string | null {
  const direct = asString(value);
  if (direct) return direct;
  return asString(asRecord(value)?.id);
}

function secondsToDate(value: unknown): Date | null {
  const seconds = asNumber(value);
  return seconds === null ? null : new Date(seconds * 1000);
}

function metadataOrganizationId(object: StripeObject): string | null {
  const metadata = asRecord(object.metadata);
  return asString(metadata?.organizationId) ?? asString(metadata?.organization_id);
}

function subscriptionItem(subscription: StripeObject): StripeObject | null {
  const data = asRecord(subscription.items)?.data;
  return Array.isArray(data) ? asRecord(data[0]) : null;
}

function subscriptionPriceId(subscription: StripeObject): string | null {
  return idFrom(subscriptionItem(subscription)?.price);
}

function subscriptionPeriod(subscription: StripeObject): { start: Date | null; end: Date | null } {
  const item = subscriptionItem(subscription);
  return {
    start: secondsToDate(subscription.current_period_start) ?? secondsToDate(item?.current_period_start),
    end: secondsToDate(subscription.current_period_end) ?? secondsToDate(item?.current_period_end),
  };
}

function invoiceSubscriptionId(invoice: StripeObject): string | null {
  const parent = asRecord(invoice.parent);
  const subscriptionDetails = asRecord(parent?.subscription_details);
  const lines = asRecord(invoice.lines)?.data;
  const firstLine = Array.isArray(lines) ? asRecord(lines[0]) : null;
  const lineParent = asRecord(firstLine?.parent);
  const subscriptionItemDetails = asRecord(lineParent?.subscription_item_details);
  return idFrom(invoice.subscription)
    ?? idFrom(subscriptionDetails?.subscription)
    ?? idFrom(subscriptionItemDetails?.subscription);
}

function invoicePaymentId(invoice: StripeObject): string | null {
  const payments = asRecord(invoice.payments)?.data;
  const firstPayment = Array.isArray(payments) ? asRecord(payments[0]) : null;
  const payment = asRecord(firstPayment?.payment);
  return idFrom(invoice.payment_intent)
    ?? idFrom(payment?.payment_intent)
    ?? idFrom(invoice.charge);
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 86_400_000);
}

export function mapStripeSubscriptionStatus(
  providerStatus: string,
  now: Date,
  graceDays: number,
  existingGraceEndsAt?: Date | null,
) {
  switch (providerStatus) {
    case "trialing":
      return { status: "trialing" as const, graceEndsAt: null, cancelledAt: null, suspendedAt: null };
    case "active":
      return { status: "active" as const, graceEndsAt: null, cancelledAt: null, suspendedAt: null };
    case "past_due":
      return {
        status: "grace_period" as const,
        graceEndsAt: existingGraceEndsAt && existingGraceEndsAt > now ? existingGraceEndsAt : addDays(now, graceDays),
        cancelledAt: null,
        suspendedAt: null,
      };
    case "unpaid":
    case "paused":
      return { status: "suspended" as const, graceEndsAt: null, cancelledAt: null, suspendedAt: now };
    case "canceled":
    case "incomplete_expired":
      return { status: "cancelled" as const, graceEndsAt: null, cancelledAt: now, suspendedAt: null };
    case "incomplete":
      return { status: "past_due" as const, graceEndsAt: null, cancelledAt: null, suspendedAt: null };
    default:
      throw new Error(`Unsupported Stripe subscription status: ${providerStatus}`);
  }
}

function mapInvoiceStatus(value: unknown) {
  switch (asString(value)) {
    case "draft": return "draft" as const;
    case "open": return "open" as const;
    case "paid": return "paid" as const;
    case "void": return "void" as const;
    case "uncollectible": return "uncollectible" as const;
    default: return "open" as const;
  }
}

async function resolveOrganizationId(
  tx: BillingTransaction,
  object: StripeObject,
  subscriptionExternalId?: string | null,
): Promise<string> {
  const fromMetadata = metadataOrganizationId(object);
  if (fromMetadata) return fromMetadata;

  const customerExternalId = idFrom(object.customer);
  if (customerExternalId) {
    const account = (
      await tx
        .select({ organizationId: schema.billingAccounts.organizationId })
        .from(schema.billingAccounts)
        .where(and(
          eq(schema.billingAccounts.providerKey, "stripe"),
          eq(schema.billingAccounts.providerCustomerId, customerExternalId),
        ))
        .limit(1)
    )[0];
    if (account) return account.organizationId;
  }

  const externalSubscriptionId = subscriptionExternalId ?? idFrom(object.subscription);
  if (externalSubscriptionId) {
    const subscription = (
      await tx
        .select({ organizationId: schema.billingSubscriptions.organizationId })
        .from(schema.billingSubscriptions)
        .where(and(
          eq(schema.billingSubscriptions.providerKey, "stripe"),
          eq(schema.billingSubscriptions.providerSubscriptionId, externalSubscriptionId),
        ))
        .limit(1)
    )[0];
    if (subscription) return subscription.organizationId;
  }

  throw new Error("Could not resolve workspace for Stripe event");
}

async function billingAccountFor(tx: BillingTransaction, organizationId: string) {
  const account = (
    await tx
      .select()
      .from(schema.billingAccounts)
      .where(eq(schema.billingAccounts.organizationId, organizationId))
      .limit(1)
  )[0];
  if (!account) throw new Error("Billing account is not initialized");
  return account;
}

async function resolvePlanVersionId(
  tx: BillingTransaction,
  priceId: string,
  priceRefs: StripePriceRefs,
): Promise<string> {
  const existing = (
    await tx
      .select({ id: schema.billingPlanVersions.id })
      .from(schema.billingPlanVersions)
      .where(eq(schema.billingPlanVersions.providerPriceRef, priceId))
      .limit(1)
  )[0];
  if (existing) return existing.id;

  const planCode = Object.entries(priceRefs).find(([, configuredPrice]) => configuredPrice === priceId)?.[0];
  if (!planCode) throw new Error(`Stripe Price ${priceId} is not mapped to a billing plan`);
  const planVersion = (
    await tx
      .select({ id: schema.billingPlanVersions.id })
      .from(schema.billingPlanVersions)
      .innerJoin(schema.billingPlans, eq(schema.billingPlans.id, schema.billingPlanVersions.planId))
      .where(and(eq(schema.billingPlans.code, planCode), eq(schema.billingPlans.isActive, true)))
      .orderBy(desc(schema.billingPlanVersions.version))
      .limit(1)
  )[0];
  if (!planVersion) throw new Error(`Billing plan ${planCode} is not configured`);

  await tx
    .update(schema.billingPlanVersions)
    .set({ providerPriceRef: priceId })
    .where(eq(schema.billingPlanVersions.id, planVersion.id));
  return planVersion.id;
}

async function syncCheckoutSession(tx: BillingTransaction, session: StripeObject): Promise<void> {
  const organizationId = metadataOrganizationId(session) ?? asString(session.client_reference_id);
  if (!organizationId) throw new Error("Stripe Checkout session is missing organization metadata");
  const customerExternalId = idFrom(session.customer);
  const providerSubscriptionId = idFrom(session.subscription);
  const account = await billingAccountFor(tx, organizationId);

  if (customerExternalId) {
    await tx
      .update(schema.billingAccounts)
      .set({ providerKey: "stripe", providerCustomerId: customerExternalId, updatedAt: new Date() })
      .where(eq(schema.billingAccounts.id, account.id));
  }
  if (providerSubscriptionId) {
    const current = (
      await tx
        .select({ id: schema.billingSubscriptions.id })
        .from(schema.billingSubscriptions)
        .where(eq(schema.billingSubscriptions.organizationId, organizationId))
        .orderBy(desc(schema.billingSubscriptions.createdAt))
        .limit(1)
    )[0];
    if (current) {
      await tx
        .update(schema.billingSubscriptions)
        .set({ providerKey: "stripe", providerSubscriptionId, isManual: false, updatedAt: new Date() })
        .where(eq(schema.billingSubscriptions.id, current.id));
    }
  }
}

async function syncSubscription(
  tx: BillingTransaction,
  subscription: StripeObject,
  options: Required<Pick<StripeWebhookServiceOptions, "failedPaymentGraceDays" | "now">> & Pick<StripeWebhookServiceOptions, "priceRefs">,
): Promise<void> {
  const providerSubscriptionId = asString(subscription.id);
  const providerStatus = asString(subscription.status);
  const priceId = subscriptionPriceId(subscription);
  if (!providerSubscriptionId || !providerStatus || !priceId) throw new Error("Stripe subscription payload is incomplete");

  const organizationId = await resolveOrganizationId(tx, subscription, providerSubscriptionId);
  const customerExternalId = idFrom(subscription.customer);
  const planVersionId = await resolvePlanVersionId(tx, priceId, options.priceRefs);
  const account = await billingAccountFor(tx, organizationId);
  if (customerExternalId) {
    await tx
      .update(schema.billingAccounts)
      .set({ providerKey: "stripe", providerCustomerId: customerExternalId, updatedAt: options.now() })
      .where(eq(schema.billingAccounts.id, account.id));
  }

  const byProvider = (
    await tx
      .select()
      .from(schema.billingSubscriptions)
      .where(and(
        eq(schema.billingSubscriptions.providerKey, "stripe"),
        eq(schema.billingSubscriptions.providerSubscriptionId, providerSubscriptionId),
      ))
      .limit(1)
  )[0];
  const current = byProvider ?? (
    await tx
      .select()
      .from(schema.billingSubscriptions)
      .where(eq(schema.billingSubscriptions.organizationId, organizationId))
      .orderBy(desc(schema.billingSubscriptions.createdAt))
      .limit(1)
  )[0];

  const now = options.now();
  const mapped = mapStripeSubscriptionStatus(providerStatus, now, options.failedPaymentGraceDays, current?.graceEndsAt);
  const period = subscriptionPeriod(subscription);
  const periodStart = period.start ?? current?.currentPeriodStart ?? now;
  const periodEnd = period.end ?? current?.currentPeriodEnd ?? addDays(now, 30);
  const trialEndsAt = secondsToDate(subscription.trial_end);
  const cancelAtPeriodEnd = subscription.cancel_at_period_end === true;
  const cancelledAt = secondsToDate(subscription.canceled_at) ?? mapped.cancelledAt;

  const updated = current
    ? (
        await tx
          .update(schema.billingSubscriptions)
          .set({
            billingAccountId: account.id,
            planVersionId,
            providerKey: "stripe",
            providerSubscriptionId,
            status: mapped.status,
            isManual: false,
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
            trialEndsAt,
            graceEndsAt: mapped.graceEndsAt,
            cancelAtPeriodEnd,
            cancelledAt,
            suspendedAt: mapped.suspendedAt,
            updatedAt: now,
          })
          .where(eq(schema.billingSubscriptions.id, current.id))
          .returning()
      )[0]
    : (
        await tx
          .insert(schema.billingSubscriptions)
          .values({
            billingAccountId: account.id,
            organizationId,
            planVersionId,
            providerKey: "stripe",
            providerSubscriptionId,
            status: mapped.status,
            isManual: false,
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
            trialEndsAt,
            graceEndsAt: mapped.graceEndsAt,
            cancelAtPeriodEnd,
            cancelledAt,
            suspendedAt: mapped.suspendedAt,
          })
          .returning()
      )[0];
  if (!updated) throw new Error("Could not synchronize Stripe subscription");

  if (!current || current.planVersionId !== planVersionId || current.status !== mapped.status || current.cancelAtPeriodEnd !== cancelAtPeriodEnd) {
    const kind = !current
      ? "activation"
      : mapped.status === "cancelled"
        ? "cancellation"
        : current.planVersionId !== planVersionId
          ? "plan_change"
          : "provider_status_sync";
    await tx.insert(schema.billingSubscriptionChanges).values({
      organizationId,
      subscriptionId: updated.id,
      fromPlanVersionId: current?.planVersionId ?? null,
      toPlanVersionId: planVersionId,
      fromStatus: current?.status ?? null,
      toStatus: mapped.status,
      kind,
      effectiveAt: now,
      metadata: { source: "stripe_webhook", providerSubscriptionId },
    });
  }
}

async function syncInvoice(
  tx: BillingTransaction,
  invoice: StripeObject,
  eventType: string,
  options: Required<Pick<StripeWebhookServiceOptions, "failedPaymentGraceDays" | "now">>,
): Promise<void> {
  const providerInvoiceId = asString(invoice.id);
  if (!providerInvoiceId) throw new Error("Stripe invoice payload is missing id");
  const providerSubscriptionId = invoiceSubscriptionId(invoice);
  const organizationId = await resolveOrganizationId(tx, invoice, providerSubscriptionId);
  const account = await billingAccountFor(tx, organizationId);
  const localSubscription = providerSubscriptionId
    ? (
        await tx
          .select()
          .from(schema.billingSubscriptions)
          .where(and(
            eq(schema.billingSubscriptions.providerKey, "stripe"),
            eq(schema.billingSubscriptions.providerSubscriptionId, providerSubscriptionId),
          ))
          .limit(1)
      )[0]
    : null;

  const status = mapInvoiceStatus(invoice.status);
  const currency = (asString(invoice.currency) ?? "USD").toUpperCase();
  const subtotalMinor = asNumber(invoice.subtotal) ?? 0;
  const totalMinor = asNumber(invoice.total) ?? subtotalMinor;
  const amountDueMinor = asNumber(invoice.amount_due) ?? Math.max(0, totalMinor - (asNumber(invoice.amount_paid) ?? 0));
  const amountPaidMinor = asNumber(invoice.amount_paid) ?? 0;
  const statusTransitions = asRecord(invoice.status_transitions);
  const paidAt = secondsToDate(statusTransitions?.paid_at);
  const now = options.now();

  const existing = (
    await tx
      .select()
      .from(schema.billingInvoices)
      .where(and(
        eq(schema.billingInvoices.providerKey, "stripe"),
        eq(schema.billingInvoices.providerInvoiceId, providerInvoiceId),
      ))
      .limit(1)
  )[0];

  const values = {
    organizationId,
    billingAccountId: account.id,
    subscriptionId: localSubscription?.id ?? null,
    providerKey: "stripe",
    providerInvoiceId,
    invoiceNumber: asString(invoice.number),
    status,
    currency,
    subtotalMinor,
    taxMinor: Math.max(0, totalMinor - subtotalMinor),
    totalMinor,
    amountDueMinor,
    amountPaidMinor,
    periodStart: secondsToDate(invoice.period_start),
    periodEnd: secondsToDate(invoice.period_end),
    dueAt: secondsToDate(invoice.due_date),
    paidAt,
    metadata: { providerEventType: eventType },
  };

  const localInvoice = existing
    ? (
        await tx
          .update(schema.billingInvoices)
          .set({ ...values, updatedAt: now })
          .where(eq(schema.billingInvoices.id, existing.id))
          .returning()
      )[0]
    : (
        await tx.insert(schema.billingInvoices).values(values).returning()
      )[0];
  if (!localInvoice) throw new Error("Could not synchronize Stripe invoice");

  const providerPaymentId = invoicePaymentId(invoice);
  const failed = eventType === "invoice.payment_failed";
  const succeeded = eventType === "invoice.paid" || eventType === "invoice.payment_succeeded" || status === "paid";
  if (providerPaymentId && (failed || succeeded)) {
    const paymentStatus = failed ? "failed" as const : "succeeded" as const;
    const paymentAmount = succeeded ? Math.max(amountPaidMinor, totalMinor) : Math.max(amountDueMinor, totalMinor);
    const existingPayment = (
      await tx
        .select()
        .from(schema.billingPayments)
        .where(and(
          eq(schema.billingPayments.providerKey, "stripe"),
          eq(schema.billingPayments.providerPaymentId, providerPaymentId),
        ))
        .limit(1)
    )[0];
    if (existingPayment) {
      await tx
        .update(schema.billingPayments)
        .set({
          invoiceId: localInvoice.id,
          status: paymentStatus,
          currency,
          amountMinor: paymentAmount,
          paidAt: succeeded ? paidAt ?? now : null,
          metadata: { providerInvoiceId },
        })
        .where(eq(schema.billingPayments.id, existingPayment.id));
    } else {
      await tx.insert(schema.billingPayments).values({
        organizationId,
        invoiceId: localInvoice.id,
        providerKey: "stripe",
        providerPaymentId,
        status: paymentStatus,
        currency,
        amountMinor: paymentAmount,
        paidAt: succeeded ? paidAt ?? now : null,
        metadata: { providerInvoiceId },
      });
    }
  }

  if (localSubscription && failed) {
    const graceEndsAt = localSubscription.graceEndsAt && localSubscription.graceEndsAt > now
      ? localSubscription.graceEndsAt
      : addDays(now, options.failedPaymentGraceDays);
    await tx
      .update(schema.billingSubscriptions)
      .set({ status: "grace_period", graceEndsAt, updatedAt: now })
      .where(eq(schema.billingSubscriptions.id, localSubscription.id));
  }
  if (localSubscription && succeeded && ["past_due", "grace_period"].includes(localSubscription.status)) {
    await tx
      .update(schema.billingSubscriptions)
      .set({ status: "active", graceEndsAt: null, suspendedAt: null, updatedAt: now })
      .where(eq(schema.billingSubscriptions.id, localSubscription.id));
  }
}

async function syncRefund(tx: BillingTransaction, refundOrCharge: StripeObject): Promise<void> {
  const paymentExternalId = idFrom(refundOrCharge.payment_intent) ?? idFrom(refundOrCharge.charge) ?? asString(refundOrCharge.id);
  if (!paymentExternalId) return;
  const payment = (
    await tx
      .select()
      .from(schema.billingPayments)
      .where(and(
        eq(schema.billingPayments.providerKey, "stripe"),
        eq(schema.billingPayments.providerPaymentId, paymentExternalId),
      ))
      .limit(1)
  )[0];
  if (!payment) return;

  const refundedAmountMinor = asNumber(refundOrCharge.amount_refunded) ?? asNumber(refundOrCharge.amount) ?? payment.amountMinor;
  await tx
    .update(schema.billingPayments)
    .set({
      refundedAmountMinor,
      status: refundedAmountMinor >= payment.amountMinor ? "refunded" : "partially_refunded",
      metadata: { ...(asRecord(payment.metadata) ?? {}), lastRefundId: asString(refundOrCharge.id) },
    })
    .where(eq(schema.billingPayments.id, payment.id));
}

export function createStripeWebhookService(db: BillingDb, options: StripeWebhookServiceOptions) {
  const normalized = {
    priceRefs: options.priceRefs,
    failedPaymentGraceDays: options.failedPaymentGraceDays ?? 7,
    now: options.now ?? (() => new Date()),
  };

  return {
    async process(event: BillingProviderWebhookEvent): Promise<StripeWebhookProcessResult> {
      await db
        .insert(schema.billingProviderEvents)
        .values({
          providerKey: "stripe",
          externalEventId: event.externalEventId,
          eventType: event.type,
          payload: event.raw,
          verifiedAt: normalized.now(),
        })
        .onConflictDoNothing({
          target: [schema.billingProviderEvents.providerKey, schema.billingProviderEvents.externalEventId],
        });

      return db.transaction(async (tx) => {
        await tx.execute(sql`
          SELECT ${schema.billingProviderEvents.id}
          FROM ${schema.billingProviderEvents}
          WHERE ${schema.billingProviderEvents.providerKey} = 'stripe'
            AND ${schema.billingProviderEvents.externalEventId} = ${event.externalEventId}
          FOR UPDATE
        `);
        const ledger = (
          await tx
            .select({ id: schema.billingProviderEvents.id, processedAt: schema.billingProviderEvents.processedAt })
            .from(schema.billingProviderEvents)
            .where(and(
              eq(schema.billingProviderEvents.providerKey, "stripe"),
              eq(schema.billingProviderEvents.externalEventId, event.externalEventId),
            ))
            .limit(1)
        )[0];
        if (!ledger) throw new Error("Stripe provider event ledger row is missing");
        if (ledger.processedAt) return { processed: false, replay: true };

        const object = event.data;
        if (event.type === "checkout.session.completed") {
          await syncCheckoutSession(tx, object);
        } else if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) {
          await syncSubscription(tx, object, normalized);
        } else if (event.type.startsWith("invoice.")) {
          await syncInvoice(tx, object, event.type, normalized);
        } else if (["charge.refunded", "refund.created", "refund.updated"].includes(event.type)) {
          await syncRefund(tx, object);
        }

        await tx
          .update(schema.billingProviderEvents)
          .set({ processedAt: normalized.now() })
          .where(eq(schema.billingProviderEvents.id, ledger.id));
        return { processed: true, replay: false };
      });
    },
  };
}
