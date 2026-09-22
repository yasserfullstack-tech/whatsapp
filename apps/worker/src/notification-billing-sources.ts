import { and, eq, gte, isNotNull } from "drizzle-orm";
import { schema } from "@wa/db";
import {
  adminUserIds,
  asRecord,
  asString,
  subscriptionNotificationType,
  usagePercent,
  type Database,
  type NotificationEmitter,
} from "./notification-source-utils";

export async function emitPaymentFailures(db: Database, notifications: NotificationEmitter, since: Date): Promise<number> {
  const events = await db
    .select({
      id: schema.billingProviderEvents.id,
      providerKey: schema.billingProviderEvents.providerKey,
      payload: schema.billingProviderEvents.payload,
      processedAt: schema.billingProviderEvents.processedAt,
      createdAt: schema.billingProviderEvents.createdAt,
    })
    .from(schema.billingProviderEvents)
    .where(and(
      eq(schema.billingProviderEvents.eventType, "invoice.payment_failed"),
      isNotNull(schema.billingProviderEvents.processedAt),
      gte(schema.billingProviderEvents.processedAt, since),
    ));

  let emitted = 0;
  for (const event of events) {
    const payload = asRecord(event.payload);
    const data = asRecord(payload?.data);
    const object = asRecord(data?.object);
    const providerInvoiceId = asString(object?.id);
    if (!providerInvoiceId) continue;
    const invoice = (
      await db
        .select({ id: schema.billingInvoices.id, organizationId: schema.billingInvoices.organizationId })
        .from(schema.billingInvoices)
        .where(and(
          eq(schema.billingInvoices.providerKey, event.providerKey),
          eq(schema.billingInvoices.providerInvoiceId, providerInvoiceId),
        ))
        .limit(1)
    )[0];
    if (!invoice) continue;
    const result = await notifications.emit({
      id: `billing-provider:${event.id}`,
      type: "billing_payment_failed",
      organizationId: invoice.organizationId,
      userIds: await adminUserIds(db, invoice.organizationId),
      metadata: { invoiceId: invoice.id, providerInvoiceId },
      link: "/settings/billing",
      occurredAt: event.processedAt ?? event.createdAt,
    });
    emitted += result.notificationsCreated;
  }
  return emitted;
}

export async function emitSubscriptionChanges(db: Database, notifications: NotificationEmitter, since: Date): Promise<number> {
  const changes = await db
    .select({
      id: schema.billingSubscriptionChanges.id,
      organizationId: schema.billingSubscriptionChanges.organizationId,
      subscriptionId: schema.billingSubscriptionChanges.subscriptionId,
      toPlanVersionId: schema.billingSubscriptionChanges.toPlanVersionId,
      fromStatus: schema.billingSubscriptionChanges.fromStatus,
      toStatus: schema.billingSubscriptionChanges.toStatus,
      kind: schema.billingSubscriptionChanges.kind,
      effectiveAt: schema.billingSubscriptionChanges.effectiveAt,
      createdAt: schema.billingSubscriptionChanges.createdAt,
    })
    .from(schema.billingSubscriptionChanges)
    .where(gte(schema.billingSubscriptionChanges.createdAt, since));

  let emitted = 0;
  for (const change of changes) {
    let planName: string | undefined;
    if (change.toPlanVersionId) {
      const plan = (
        await db
          .select({ name: schema.billingPlans.name })
          .from(schema.billingPlanVersions)
          .innerJoin(schema.billingPlans, eq(schema.billingPlans.id, schema.billingPlanVersions.planId))
          .where(eq(schema.billingPlanVersions.id, change.toPlanVersionId))
          .limit(1)
      )[0];
      planName = plan?.name;
    }
    const type = subscriptionNotificationType(change.toStatus);
    const result = await notifications.emit({
      id: `subscription-change:${change.id}`,
      type,
      organizationId: change.organizationId,
      userIds: await adminUserIds(db, change.organizationId),
      metadata: {
        subscriptionId: change.subscriptionId,
        planName,
        fromStatus: change.fromStatus,
        toStatus: change.toStatus,
        kind: change.kind,
        detail: type === "subscription_changed" ? "The workspace subscription configuration changed." : undefined,
      },
      link: "/settings/billing",
      occurredAt: change.effectiveAt ?? change.createdAt,
    });
    emitted += result.notificationsCreated;
  }
  return emitted;
}

export async function emitUsageThresholds(db: Database, notifications: NotificationEmitter, since: Date): Promise<number> {
  const usageRows = await db
    .select({
      id: schema.billingPeriodUsage.id,
      organizationId: schema.billingPeriodUsage.organizationId,
      subscriptionId: schema.billingPeriodUsage.subscriptionId,
      entitlementKey: schema.billingPeriodUsage.entitlementKey,
      quantity: schema.billingPeriodUsage.quantity,
      periodStart: schema.billingPeriodUsage.periodStart,
      periodEnd: schema.billingPeriodUsage.periodEnd,
      updatedAt: schema.billingPeriodUsage.updatedAt,
    })
    .from(schema.billingPeriodUsage)
    .where(gte(schema.billingPeriodUsage.updatedAt, since));

  let emitted = 0;
  for (const usage of usageRows) {
    const subscription = (
      await db
        .select({ planVersionId: schema.billingSubscriptions.planVersionId })
        .from(schema.billingSubscriptions)
        .where(and(
          eq(schema.billingSubscriptions.id, usage.subscriptionId),
          eq(schema.billingSubscriptions.organizationId, usage.organizationId),
        ))
        .limit(1)
    )[0];
    if (!subscription) continue;
    const entitlement = (
      await db
        .select({ limit: schema.billingPlanEntitlements.limitValue })
        .from(schema.billingPlanEntitlements)
        .where(and(
          eq(schema.billingPlanEntitlements.planVersionId, subscription.planVersionId),
          eq(schema.billingPlanEntitlements.key, usage.entitlementKey),
          eq(schema.billingPlanEntitlements.enabled, true),
        ))
        .limit(1)
    )[0];
    const percent = usagePercent(usage.quantity, entitlement?.limit ?? null);
    if (percent === null || percent < 80) continue;
    const result = await notifications.emit({
      id: `usage-threshold:${usage.id}:80`,
      type: "usage_limit_approaching",
      organizationId: usage.organizationId,
      metadata: {
        entitlementKey: usage.entitlementKey,
        used: usage.quantity,
        limit: entitlement?.limit,
        percent,
        periodStart: usage.periodStart.toISOString(),
        periodEnd: usage.periodEnd.toISOString(),
      },
      link: "/settings/billing",
      occurredAt: usage.updatedAt,
    });
    emitted += result.notificationsCreated;
  }
  return emitted;
}
