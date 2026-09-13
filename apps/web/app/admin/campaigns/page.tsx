import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { schema } from "@wa/db";
import { AdminBadge, AdminSection } from "@/components/admin-ui";
import { db } from "@/lib/server";

type PageProps = { searchParams: Promise<{ campaignId?: string }> };

export default async function AdminCampaignsPage({ searchParams }: PageProps) {
  const { campaignId } = await searchParams;
  const campaigns = await db.select({
    id: schema.campaigns.id, name: schema.campaigns.name, status: schema.campaigns.status, recipientCount: schema.campaigns.recipientCount,
    organizationName: schema.organizations.name, createdAt: schema.campaigns.createdAt,
  }).from(schema.campaigns).innerJoin(schema.organizations, eq(schema.organizations.id, schema.campaigns.organizationId)).orderBy(desc(schema.campaigns.createdAt)).limit(150);

  const failedRecipients = campaignId ? await db.select({
    id: schema.campaignRecipients.id, phone: schema.campaignRecipients.phoneE164, errorCode: schema.campaignRecipients.errorCode,
    error: schema.campaignRecipients.lastError, attempts: schema.campaignRecipients.attemptCount, failedAt: schema.campaignRecipients.failedAt,
  }).from(schema.campaignRecipients).where(and(eq(schema.campaignRecipients.campaignId, campaignId), eq(schema.campaignRecipients.status, "failed"))).orderBy(desc(schema.campaignRecipients.failedAt)).limit(100) : [];
  const selected = campaigns.find((campaign) => campaign.id === campaignId);

  return <>
    <header className="admin-header"><div><h1>Campaigns</h1><p>Cross-organization campaign inspection, including failed recipient attempts.</p></div></header>
    {selected ? <AdminSection title={`Inspect: ${selected.name}`} action={<Link href="/admin/campaigns">Close inspection</Link>}>
      <div className="admin-kv"><div><span>Organization</span><strong>{selected.organizationName}</strong></div><div><span>Status</span><strong>{selected.status}</strong></div><div><span>Recipients</span><strong>{selected.recipientCount.toLocaleString()}</strong></div></div>
      <h3>Recipient attempts</h3>{failedRecipients.length ? <table className="admin-table"><thead><tr><th>Recipient</th><th>Attempts</th><th>Error code</th><th>Last error</th><th>Failed</th></tr></thead><tbody>{failedRecipients.map((row) => <tr key={row.id}><td>{row.phone}</td><td>{row.attempts}</td><td>{row.errorCode ?? "—"}</td><td className="admin-error">{row.error ?? "—"}</td><td>{row.failedAt?.toLocaleString() ?? "—"}</td></tr>)}</tbody></table> : <p className="admin-empty">No failed recipient rows found.</p>}
    </AdminSection> : null}
    <AdminSection title="Recent campaigns"><table className="admin-table"><thead><tr><th>Campaign</th><th>Organization</th><th>Status</th><th>Recipients</th><th>Created</th><th></th></tr></thead><tbody>{campaigns.map((campaign) => <tr key={campaign.id}><td>{campaign.name}</td><td>{campaign.organizationName}</td><td><AdminBadge tone={campaign.status === "failed" ? "bad" : campaign.status === "completed" ? "good" : "neutral"}>{campaign.status}</AdminBadge></td><td>{campaign.recipientCount.toLocaleString()}</td><td>{campaign.createdAt.toLocaleString()}</td><td><Link href={`/admin/campaigns?campaignId=${campaign.id}`}>Inspect</Link></td></tr>)}</tbody></table></AdminSection>
  </>;
}
