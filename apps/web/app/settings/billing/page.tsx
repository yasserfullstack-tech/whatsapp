import { entitlementDefinitions, type EntitlementKey } from "@wa/billing";
import { SettingsNav } from "@/components/settings-nav";
import { requireAuthContext } from "@/lib/auth-context";
import { getBillingOverview } from "@/lib/billing-server";
import { billingMessages } from "@/lib/i18n/billing";
import { getI18n } from "@/lib/i18n/server";
import { can } from "@/lib/workspace-access";

const entitlementOrder = Object.keys(entitlementDefinitions) as EntitlementKey[];

function formatAmount(locale: string, currency: string, amountMinor: number): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amountMinor / 100);
}

export default async function BillingSettingsPage() {
  const [{ workspace }, i18n] = await Promise.all([requireAuthContext(), getI18n()]);
  const overview = await getBillingOverview(workspace.organizationId);
  const canManage = can(workspace.role, "billing.manage");
  const m = billingMessages[i18n.locale];
  const date = new Intl.DateTimeFormat(i18n.localeTag, { dateStyle: "medium" });
  const integer = new Intl.NumberFormat(i18n.localeTag, { maximumFractionDigits: 0 });
  const entitlementByKey = new Map(overview.entitlements.map((entry) => [entry.key, entry]));
  const subscription = overview.subscription;
  const planName = subscription
    ? subscription.planCode in m.planLabels
      ? m.planLabels[subscription.planCode as keyof typeof m.planLabels]
      : subscription.planName
    : m.noPlan;

  return (
    <>
      <header className="topbar settingsHeader">
        <div>
          <p className="eyebrow">{m.eyebrow}</p>
          <h1>{m.title}</h1>
          <p className="subtitle">{m.subtitle}</p>
        </div>
        <span className="roleBadge">{canManage ? m.manage : m.readOnly}</span>
      </header>
      <SettingsNav active="/settings/billing" />

      <section className="billingSummary" aria-label={m.currentPlan}>
        <article className="panel billingSummaryCard">
          <span className="billingLabel">{m.currentPlan}</span>
          <strong>{planName}</strong>
          {subscription?.isManual ? <small>{m.manualBilling}</small> : null}
        </article>
        <article className="panel billingSummaryCard">
          <span className="billingLabel">{m.subscriptionStatus}</span>
          <strong>{subscription ? m.statusLabels[subscription.status] : "—"}</strong>
        </article>
        <article className="panel billingSummaryCard">
          <span className="billingLabel">{m.billingPeriod}</span>
          <strong className="billingPeriodValue">
            {subscription ? `${date.format(subscription.currentPeriodStart)} – ${date.format(subscription.currentPeriodEnd)}` : "—"}
          </strong>
        </article>
      </section>

      {!subscription ? (
        <section className="panel settingsPanel">
          <div className="settingsCallout"><strong>{m.noPlan}</strong><p>{m.noSubscription}</p></div>
        </section>
      ) : null}

      <section className="panel settingsPanel">
        <div className="panelHeader">
          <div>
            <h2>{m.usageTitle}</h2>
            <p className="subtitle">{m.usageSubtitle}</p>
          </div>
        </div>
        <div className="billingEntitlements">
          {entitlementOrder.map((key) => {
            const entitlement = entitlementByKey.get(key);
            const enabled = entitlement?.enabled ?? false;
            const limit = enabled ? entitlement?.limit ?? null : 0;
            const used = enabled ? entitlement?.used ?? null : null;
            const remaining = used === null || limit === null ? null : Math.max(0, limit - used);
            const mode = entitlementDefinitions[key].mode;
            return (
              <article className="billingEntitlement" key={key}>
                <strong>{m.entitlementLabels[key]}</strong>
                <dl>
                  <div><dt>{m.usage}</dt><dd>{mode === "configuration" ? m.notApplicable : integer.format(used ?? 0)}</dd></div>
                  <div><dt>{m.limit}</dt><dd>{limit === null ? m.unlimited : integer.format(limit)}</dd></div>
                  <div><dt>{m.remaining}</dt><dd>{mode === "configuration" ? m.notApplicable : limit === null ? m.unlimited : integer.format(remaining ?? 0)}</dd></div>
                </dl>
                {mode !== "configuration" && limit !== null && used !== null ? (
                  <div className="billingProgress" aria-hidden="true">
                    <span style={{ inlineSize: `${Math.min(100, limit > 0 ? (used / limit) * 100 : 100)}%` }} />
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      <section className="billingCalloutGrid">
        <article className="panel settingsPanel">
          <h2>{m.upgrade}</h2>
          <p className="subtitle">{m.upgradeBody}</p>
          <button className="primary billingDisabledButton" type="button" disabled>{m.upgradeButton}</button>
        </article>
        <article className="panel settingsPanel">
          <h2>{m.manualBilling}</h2>
          <p className="subtitle">{m.manualBillingBody}</p>
        </article>
        <article className="panel settingsPanel billingMetaNotice">
          <h2>{m.metaTitle}</h2>
          <p className="subtitle">{m.metaBody}</p>
        </article>
      </section>

      <section className="panel settingsPanel">
        <div className="panelHeader">
          <div><h2>{m.invoices}</h2><p className="subtitle">{m.invoicesSubtitle}</p></div>
        </div>
        {overview.invoices.length ? (
          <div className="billingTableWrap">
            <table className="billingTable">
              <thead><tr><th>{m.invoice}</th><th>{m.amount}</th><th>{m.status}</th><th>{m.date}</th></tr></thead>
              <tbody>
                {overview.invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>{invoice.invoiceNumber ?? invoice.id.slice(0, 8)}</td>
                    <td>{formatAmount(i18n.localeTag, invoice.currency, invoice.totalMinor)}</td>
                    <td>{m.invoiceStatusLabels[invoice.status]}</td>
                    <td>{date.format(invoice.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="settingsHint">{m.noInvoices}</p>}
      </section>

      <section className="panel settingsPanel">
        <div className="panelHeader">
          <div><h2>{m.payments}</h2><p className="subtitle">{m.paymentsSubtitle}</p></div>
        </div>
        {overview.payments.length ? (
          <div className="billingTableWrap">
            <table className="billingTable">
              <thead><tr><th>{m.payment}</th><th>{m.amount}</th><th>{m.status}</th><th>{m.date}</th></tr></thead>
              <tbody>
                {overview.payments.map((payment) => (
                  <tr key={payment.id}>
                    <td>{payment.id.slice(0, 8)}</td>
                    <td>{formatAmount(i18n.localeTag, payment.currency, payment.amountMinor)}</td>
                    <td>{m.paymentStatusLabels[payment.status]}</td>
                    <td>{date.format(payment.paidAt ?? payment.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="settingsHint">{m.noPayments}</p>}
      </section>
    </>
  );
}
