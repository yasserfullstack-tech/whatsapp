import { and, count, desc, eq } from "drizzle-orm";
import { entitlementDefinitions, type EntitlementKey } from "@wa/billing";
import { schema } from "@wa/db";
import { db } from "./server";

export type BillingOverview = Awaited<ReturnType<typeof getBillingOverview>>;

export async function getBillingOverview(organizationId: string) {
  const subscription = (
    await db
      .select({
        id: schema.billingSubscriptions.id,
        status: schema.billingSubscriptions.status,
        isManual: schema.billingSubscriptions.isManual,
        currentPeriodStart: schema.billingSubscriptions.currentPeriodStart,
        currentPeriodEnd: schema.billingSubscriptions.currentPeriodEnd,
        planVersionId: schema.billingSubscriptions.planVersionId,
        planCode: schema.billingPlans.code,
        planName: schema.billingPlans.name,
        planIsCustom: schema.billingPlans.isCustom,
        providerKey: schema.billingSubscriptions.providerKey,
        providerSubscriptionId: schema.billingSubscriptions.providerSubscriptionId,
        cancelAtPeriodEnd: schema.billingSubscriptions.cancelAtPeriodEnd,
      })
      .from(schema.billingSubscriptions)
      .innerJoin(schema.billingPlanVersions, eq(schema.billingPlanVersions.id, schema.billingSubscriptions.planVersionId))
      .innerJoin(schema.billingPlans, eq(schema.billingPlans.id, schema.billingPlanVersions.planId))
      .where(eq(schema.billingSubscriptions.organizationId, organizationId))
      .orderBy(desc(schema.billingSubscriptions.createdAt))
      .limit(1)
  )[0] ?? null;

  const [account, invoices, payments, contactCount, memberCount, phoneNumberCount] = await Promise.all([
    db
      .select({
        providerKey: schema.billingAccounts.providerKey,
        providerCustomerId: schema.billingAccounts.providerCustomerId,
      })
      .from(schema.billingAccounts)
      .where(eq(schema.billingAccounts.organizationId, organizationId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({
        id: schema.billingInvoices.id,
        invoiceNumber: schema.billingInvoices.invoiceNumber,
        status: schema.billingInvoices.status,
        currency: schema.billingInvoices.currency,
        totalMinor: schema.billingInvoices.totalMinor,
        createdAt: schema.billingInvoices.createdAt,
      })
      .from(schema.billingInvoices)
      .where(eq(schema.billingInvoices.organizationId, organizationId))
      .orderBy(desc(schema.billingInvoices.createdAt))
      .limit(10),
    db
      .select({
        id: schema.billingPayments.id,
        status: schema.billingPayments.status,
        currency: schema.billingPayments.currency,
        amountMinor: schema.billingPayments.amountMinor,
        paidAt: schema.billingPayments.paidAt,
        createdAt: schema.billingPayments.createdAt,
      })
      .from(schema.billingPayments)
      .where(eq(schema.billingPayments.organizationId, organizationId))
      .orderBy(desc(schema.billingPayments.createdAt))
      .limit(10),
    db.select({ value: count() }).from(schema.contacts).where(eq(schema.contacts.organizationId, organizationId)).then((rows) => rows[0]?.value ?? 0),
    db.select({ value: count() }).from(schema.organizationMembers).where(eq(schema.organizationMembers.organizationId, organizationId)).then((rows) => rows[0]?.value ?? 0),
    db.select({ value: count() }).from(schema.whatsappPhoneNumbers).where(eq(schema.whatsappPhoneNumbers.organizationId, organizationId)).then((rows) => rows[0]?.value ?? 0),
  ]);

  if (!subscription) {
    return {
      account,
      subscription: null,
      entitlements: [] as Array<{ key: EntitlementKey; enabled: boolean; limit: number | null; used: number | null }>,
      invoices,
      payments,
    };
  }

  const [entitlementRows, usageRows] = await Promise.all([
    db
      .select({
        key: schema.billingPlanEntitlements.key,
        enabled: schema.billingPlanEntitlements.enabled,
        limit: schema.billingPlanEntitlements.limitValue,
      })
      .from(schema.billingPlanEntitlements)
      .where(eq(schema.billingPlanEntitlements.planVersionId, subscription.planVersionId)),
    db
      .select({
        key: schema.billingPeriodUsage.entitlementKey,
        quantity: schema.billingPeriodUsage.quantity,
      })
      .from(schema.billingPeriodUsage)
      .where(
        and(
          eq(schema.billingPeriodUsage.organizationId, organizationId),
          eq(schema.billingPeriodUsage.subscriptionId, subscription.id),
          eq(schema.billingPeriodUsage.periodStart, subscription.currentPeriodStart),
          eq(schema.billingPeriodUsage.periodEnd, subscription.currentPeriodEnd),
        ),
      ),
  ]);

  const usageByKey = new Map(usageRows.map((row) => [row.key, row.quantity]));
  const capacityUsage: Partial<Record<EntitlementKey, number>> = {
    max_contacts: contactCount,
    max_members: memberCount,
    max_phone_numbers: phoneNumberCount,
  };

  const entitlements = entitlementRows
    .filter((row): row is typeof row & { key: EntitlementKey } => row.key in entitlementDefinitions)
    .map((row) => {
      const mode = entitlementDefinitions[row.key].mode;
      const used = mode === "metered"
        ? usageByKey.get(row.key) ?? 0
        : mode === "capacity"
          ? capacityUsage[row.key] ?? 0
          : null;
      return { ...row, used };
    });

  return { account, subscription, entitlements, invoices, payments };
}
