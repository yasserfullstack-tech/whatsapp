import Link from "next/link";
import { and, count, desc, eq, ilike, or } from "drizzle-orm";
import { schema } from "@wa/db";
import { AdminBadge, AdminSection } from "@/components/admin-ui";
import { changeBillingPlanAction, suspendBillingSubscriptionAction } from "@/lib/billing-admin-actions";
import { db } from "@/lib/server";

type BillingStatus = "trialing" | "active" | "past_due" | "grace_period" | "suspended" | "cancelled";
type PageProps = { searchParams: Promise<{ q?: string; status?: string; page?: string }> };
const PAGE_SIZE = 50;
const billingStatuses = new Set<BillingStatus>(["trialing", "active", "past_due", "grace_period", "suspended", "cancelled"]);

function pageNumber(value?: string): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function money(currency: string, minor: number): string {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).format(minor / 100);
  } catch {
    return `${currency} ${(minor / 100).toFixed(2)}`;
  }
}

function statusTone(status: string): "good" | "warn" | "bad" | "neutral" {
  if (status === "active" || status === "paid" || status === "succeeded") return "good";
  if (status === "past_due" || status === "grace_period" || status === "open" || status === "pending") return "warn";
  if (status === "suspended" || status === "cancelled" || status === "failed" || status === "uncollectible") return "bad";
  return "neutral";
}

export default async function AdminBillingPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const q = (params.q ?? "").trim().slice(0, 160);
  const status = billingStatuses.has(params.status as BillingStatus) ? params.status as BillingStatus : "";
  const page = pageNumber(params.page);
  const filters = [
    q ? or(ilike(schema.organizations.name, `%${q}%`), ilike(schema.organizations.slug, `%${q}%`)) : undefined,
    status ? eq(schema.billingSubscriptions.status, status) : undefined,
  ].filter(Boolean);
  const where = filters.length ? and(...filters) : undefined;

  const [subscriptions, totalRows, planVersions, invoices, payments] = await Promise.all([
    db.select({
      id: schema.billingSubscriptions.id,
      organizationId: schema.billingSubscriptions.organizationId,
      organizationName: schema.organizations.name,
      organizationSlug: schema.organizations.slug,
      status: schema.billingSubscriptions.status,
      isManual: schema.billingSubscriptions.isManual,
      providerKey: schema.billingSubscriptions.providerKey,
      providerSubscriptionId: schema.billingSubscriptions.providerSubscriptionId,
      currentPeriodStart: schema.billingSubscriptions.currentPeriodStart,
      currentPeriodEnd: schema.billingSubscriptions.currentPeriodEnd,
      cancelAtPeriodEnd: schema.billingSubscriptions.cancelAtPeriodEnd,
      planVersionId: schema.billingSubscriptions.planVersionId,
      planCode: schema.billingPlans.code,
      planName: schema.billingPlans.name,
      planVersion: schema.billingPlanVersions.version,
      currency: schema.billingPlanVersions.currency,
      priceMinor: schema.billingPlanVersions.priceMinor,
    }).from(schema.billingSubscriptions)
      .innerJoin(schema.organizations, eq(schema.organizations.id, schema.billingSubscriptions.organizationId))
      .innerJoin(schema.billingPlanVersions, eq(schema.billingPlanVersions.id, schema.billingSubscriptions.planVersionId))
      .innerJoin(schema.billingPlans, eq(schema.billingPlans.id, schema.billingPlanVersions.planId))
      .where(where)
      .orderBy(desc(schema.billingSubscriptions.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ value: count() }).from(schema.billingSubscriptions)
      .innerJoin(schema.organizations, eq(schema.organizations.id, schema.billingSubscriptions.organizationId))
      .where(where),
    db.select({
      id: schema.billingPlanVersions.id,
      version: schema.billingPlanVersions.version,
      planId: schema.billingPlans.id,
      planOrganizationId: schema.billingPlans.organizationId,
      planCode: schema.billingPlans.code,
      planName: schema.billingPlans.name,
      currency: schema.billingPlanVersions.currency,
      priceMinor: schema.billingPlanVersions.priceMinor,
    }).from(schema.billingPlanVersions)
      .innerJoin(schema.billingPlans, eq(schema.billingPlans.id, schema.billingPlanVersions.planId))
      .where(eq(schema.billingPlans.isActive, true))
      .orderBy(schema.billingPlans.name, desc(schema.billingPlanVersions.version)),
    db.select({
      id: schema.billingInvoices.id,
      organizationName: schema.organizations.name,
      invoiceNumber: schema.billingInvoices.invoiceNumber,
      status: schema.billingInvoices.status,
      currency: schema.billingInvoices.currency,
      totalMinor: schema.billingInvoices.totalMinor,
      amountDueMinor: schema.billingInvoices.amountDueMinor,
      providerKey: schema.billingInvoices.providerKey,
      createdAt: schema.billingInvoices.createdAt,
    }).from(schema.billingInvoices)
      .innerJoin(schema.organizations, eq(schema.organizations.id, schema.billingInvoices.organizationId))
      .where(q ? or(ilike(schema.organizations.name, `%${q}%`), ilike(schema.organizations.slug, `%${q}%`)) : undefined)
      .orderBy(desc(schema.billingInvoices.createdAt)).limit(50),
    db.select({
      id: schema.billingPayments.id,
      organizationName: schema.organizations.name,
      invoiceId: schema.billingPayments.invoiceId,
      status: schema.billingPayments.status,
      currency: schema.billingPayments.currency,
      amountMinor: schema.billingPayments.amountMinor,
      providerKey: schema.billingPayments.providerKey,
      paidAt: schema.billingPayments.paidAt,
      createdAt: schema.billingPayments.createdAt,
    }).from(schema.billingPayments)
      .innerJoin(schema.organizations, eq(schema.organizations.id, schema.billingPayments.organizationId))
      .where(q ? or(ilike(schema.organizations.name, `%${q}%`), ilike(schema.organizations.slug, `%${q}%`)) : undefined)
      .orderBy(desc(schema.billingPayments.createdAt)).limit(50),
  ]);

  const total = totalRows[0]?.value ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (nextPage: number) => {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    if (status) next.set("status", status);
    next.set("page", String(nextPage));
    return `/admin/billing?${next.toString()}`;
  };

  return <>
    <header className="admin-header"><div><h1>Billing</h1><p>Subscriptions, invoices, payments, and guarded controls for manually managed subscriptions.</p></div></header>
    <AdminSection title="Filter subscriptions">
      <form className="admin-filter" method="get"><label>Search<input name="q" defaultValue={q} placeholder="Organization name or slug" /></label><label>Status<select name="status" defaultValue={status}><option value="">All statuses</option>{[...billingStatuses].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label><button className="admin-button" type="submit">Apply</button>{q || status ? <Link href="/admin/billing">Clear</Link> : null}</form>
    </AdminSection>
    <AdminSection title={`${total.toLocaleString()} subscriptions`}>
      <table className="admin-table"><thead><tr><th>Organization</th><th>Subscription</th><th>Plan</th><th>Period</th><th>Provider</th><th>Controls</th></tr></thead><tbody>{subscriptions.map((subscription) => {
        const availablePlans = planVersions.filter((plan) => !plan.planOrganizationId || plan.planOrganizationId === subscription.organizationId);
        return <tr key={subscription.id}>
          <td><Link href={`/admin/organizations/${subscription.organizationId}`}>{subscription.organizationName}</Link><br /><small>{subscription.organizationSlug}</small></td>
          <td><AdminBadge tone={statusTone(subscription.status)}>{subscription.status.replaceAll("_", " ")}</AdminBadge>{" "}<AdminBadge>{subscription.isManual ? "manual" : "provider managed"}</AdminBadge>{subscription.cancelAtPeriodEnd ? <><br /><small>cancels at period end</small></> : null}</td>
          <td>{subscription.planName} <small>({subscription.planCode} v{subscription.planVersion})</small><br /><small>{subscription.priceMinor == null ? "custom price" : money(subscription.currency, subscription.priceMinor)}</small></td>
          <td>{subscription.currentPeriodStart.toLocaleDateString()} → {subscription.currentPeriodEnd.toLocaleDateString()}</td>
          <td>{subscription.providerKey ?? "manual"}<br /><small>{subscription.providerSubscriptionId ?? "—"}</small></td>
          <td>{subscription.isManual ? <div className="admin-actions">
            <form className="admin-actions" action={changeBillingPlanAction}><input type="hidden" name="organizationId" value={subscription.organizationId} /><input type="hidden" name="subscriptionId" value={subscription.id} /><select name="planVersionId" defaultValue={subscription.planVersionId} aria-label={`Plan for ${subscription.organizationName}`}>{availablePlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.planName} v{plan.version}{plan.priceMinor == null ? "" : ` · ${money(plan.currency, plan.priceMinor)}`}</option>)}</select><button className="admin-button admin-button-secondary" type="submit">Change plan</button></form>
            {subscription.status !== "suspended" && subscription.status !== "cancelled" ? <form className="admin-actions" action={suspendBillingSubscriptionAction}><input type="hidden" name="organizationId" value={subscription.organizationId} /><input type="hidden" name="subscriptionId" value={subscription.id} /><input name="reason" aria-label={`Suspend reason for ${subscription.organizationName}`} placeholder="Suspension reason" /><button className="admin-button admin-button-danger" type="submit">Suspend billing</button></form> : null}
          </div> : <small>Use the billing provider for mutations to avoid provider drift.</small>}</td>
        </tr>;
      })}</tbody></table>
      <div className="admin-pagination"><span>Page {page} of {totalPages}</span><div>{page > 1 ? <Link href={href(page - 1)}>← Previous</Link> : null}{page < totalPages ? <Link href={href(page + 1)}>Next →</Link> : null}</div></div>
    </AdminSection>
    <div className="admin-two">
      <AdminSection title="Recent invoices"><table className="admin-table"><thead><tr><th>Organization</th><th>Invoice</th><th>Status</th><th>Total</th><th>Due</th><th>Created</th></tr></thead><tbody>{invoices.map((invoice) => <tr key={invoice.id}><td>{invoice.organizationName}</td><td>{invoice.invoiceNumber ?? invoice.id}<br /><small>{invoice.providerKey ?? "manual"}</small></td><td><AdminBadge tone={statusTone(invoice.status)}>{invoice.status}</AdminBadge></td><td>{money(invoice.currency, invoice.totalMinor)}</td><td>{money(invoice.currency, invoice.amountDueMinor)}</td><td>{invoice.createdAt.toLocaleString()}</td></tr>)}</tbody></table></AdminSection>
      <AdminSection title="Recent payments"><table className="admin-table"><thead><tr><th>Organization</th><th>Payment</th><th>Status</th><th>Amount</th><th>Paid</th></tr></thead><tbody>{payments.map((payment) => <tr key={payment.id}><td>{payment.organizationName}</td><td>{payment.id}<br /><small>{payment.providerKey ?? "manual"}</small></td><td><AdminBadge tone={statusTone(payment.status)}>{payment.status}</AdminBadge></td><td>{money(payment.currency, payment.amountMinor)}</td><td>{payment.paidAt?.toLocaleString() ?? payment.createdAt.toLocaleString()}</td></tr>)}</tbody></table></AdminSection>
    </div>
  </>;
}
