import Link from "next/link";
import { count, countDistinct, desc, eq, isNotNull, isNull, or } from "drizzle-orm";
import { schema } from "@wa/db";
import { AdminMetric, AdminSection } from "@/components/admin-ui";
import { campaignDispatchQueue, contactImportQueue, db, sendQueue, webhookQueue } from "@/lib/server";

export default async function AdminDashboardPage() {
  const [organizations, users, activeOrganizations, contacts, campaigns, recipients, wabas, numbers, failedImports, messages, queueState, recentErrors] = await Promise.all([
    db.select({ value: count() }).from(schema.organizations),
    db.select({ value: count() }).from(schema.users),
    db.select({ value: countDistinct(schema.organizations.id) }).from(schema.organizations)
      .leftJoin(schema.organizationAdminSettings, eq(schema.organizationAdminSettings.organizationId, schema.organizations.id))
      .where(or(isNull(schema.organizationAdminSettings.status), eq(schema.organizationAdminSettings.status, "active"))),
    db.select({ value: count() }).from(schema.contacts),
    db.select({ value: count() }).from(schema.campaigns),
    db.select({ value: count() }).from(schema.campaignRecipients),
    db.select({ value: countDistinct(schema.whatsappPhoneNumbers.wabaId) }).from(schema.whatsappPhoneNumbers)
      .where(eq(schema.whatsappPhoneNumbers.status, "connected")),
    db.select({ value: count() }).from(schema.whatsappPhoneNumbers).where(eq(schema.whatsappPhoneNumbers.status, "connected")),
    db.select({ value: count() }).from(schema.contactImports).where(eq(schema.contactImports.status, "failed")),
    Promise.all([
      db.select({ value: count() }).from(schema.campaignRecipients).where(isNotNull(schema.campaignRecipients.submittedAt)),
      db.select({ value: count() }).from(schema.campaignRecipients).where(isNotNull(schema.campaignRecipients.deliveredAt)),
      db.select({ value: count() }).from(schema.campaignRecipients).where(isNotNull(schema.campaignRecipients.failedAt)),
      db.select({ value: count() }).from(schema.campaignRecipients).where(isNotNull(schema.campaignRecipients.readAt)),
    ]),
    Promise.all([
      sendQueue.getWaitingCount(), sendQueue.getDelayedCount(), sendQueue.getFailedCount(),
      campaignDispatchQueue.getWaitingCount(), campaignDispatchQueue.getDelayedCount(), campaignDispatchQueue.getFailedCount(),
      contactImportQueue.getWaitingCount(), contactImportQueue.getDelayedCount(), contactImportQueue.getFailedCount(),
      webhookQueue.getWaitingCount(), webhookQueue.getDelayedCount(), webhookQueue.getFailedCount(),
    ]),
    db.select({
      campaign: schema.campaigns.name,
      phone: schema.campaignRecipients.phoneE164,
      error: schema.campaignRecipients.lastError,
      failedAt: schema.campaignRecipients.failedAt,
    }).from(schema.campaignRecipients)
      .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.campaignRecipients.campaignId))
      .where(isNotNull(schema.campaignRecipients.lastError)).orderBy(desc(schema.campaignRecipients.failedAt)).limit(8),
  ]);

  const [submitted, delivered, failed, read] = messages.map((rows) => rows[0]?.value ?? 0);
  const queueDepth = queueState[0] + queueState[1] + queueState[3] + queueState[4] + queueState[6] + queueState[7] + queueState[9] + queueState[10];
  const failedJobs = queueState[2] + queueState[5] + queueState[8] + queueState[11];
  const webhookBacklog = queueState[9] + queueState[10];

  const metrics = [
    ["Organizations", organizations[0]?.value ?? 0], ["Users", users[0]?.value ?? 0], ["Active organizations", activeOrganizations[0]?.value ?? 0], ["Contacts", contacts[0]?.value ?? 0],
    ["Campaigns", campaigns[0]?.value ?? 0], ["Campaign recipients", recipients[0]?.value ?? 0], ["Connected WABAs", wabas[0]?.value ?? 0], ["Connected numbers", numbers[0]?.value ?? 0],
    ["Messages submitted", submitted], ["Delivered", delivered], ["Failed", failed], ["Read", read],
    ["Queue depth", queueDepth], ["Failed jobs", failedJobs], ["Webhook backlog", webhookBacklog], ["Failed imports", failedImports[0]?.value ?? 0],
  ] as const;

  return <>
    <header className="admin-header"><div><h1>Platform overview</h1><p>Cross-organization health, messaging, and operational signals.</p></div><Link href="/dashboard">Workspace app →</Link></header>
    <div className="admin-grid">{metrics.map(([label, value]) => <AdminMetric key={label} label={label} value={Number(value).toLocaleString()} />)}</div>
    <AdminSection title="Recent system errors" action={<Link href="/admin/system">Open system health</Link>}>
      {recentErrors.length ? <table className="admin-table"><thead><tr><th>Campaign</th><th>Recipient</th><th>Error</th><th>Time</th></tr></thead><tbody>{recentErrors.map((row, index) => <tr key={`${row.phone}-${index}`}><td>{row.campaign}</td><td>{row.phone}</td><td className="admin-error">{row.error}</td><td>{row.failedAt?.toLocaleString() ?? "—"}</td></tr>)}</tbody></table> : <p className="admin-empty">No recent recipient errors.</p>}
    </AdminSection>
  </>;
}
