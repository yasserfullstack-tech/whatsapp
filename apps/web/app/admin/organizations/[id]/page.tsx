import Link from "next/link";
import { and, count, desc, eq, isNotNull } from "drizzle-orm";
import { notFound } from "next/navigation";
import { schema } from "@wa/db";
import { AdminBadge, AdminMetric, AdminSection } from "@/components/admin-ui";
import { reactivateOrganizationAction, suspendOrganizationAction, updateOrganizationPlanAction } from "@/lib/admin-actions";
import { db } from "@/lib/server";

type PageProps = { params: Promise<{ id: string }> };

export default async function OrganizationAdminPage({ params }: PageProps) {
  const { id } = await params;
  const [organization] = await db.select({
    id: schema.organizations.id, name: schema.organizations.name, slug: schema.organizations.slug, createdAt: schema.organizations.createdAt,
    status: schema.organizationAdminSettings.status, plan: schema.organizationAdminSettings.plan,
    contactLimit: schema.organizationAdminSettings.contactLimit, campaignRecipientLimit: schema.organizationAdminSettings.campaignRecipientLimit,
    monthlyMessageLimit: schema.organizationAdminSettings.monthlyMessageLimit, suspendedAt: schema.organizationAdminSettings.suspendedAt,
    suspendedReason: schema.organizationAdminSettings.suspendedReason,
  }).from(schema.organizations).leftJoin(schema.organizationAdminSettings, eq(schema.organizationAdminSettings.organizationId, schema.organizations.id)).where(eq(schema.organizations.id, id)).limit(1);
  if (!organization) notFound();

  const [members, contacts, campaigns, numbers, imports, suppressions, messageUsage, recentCampaigns, recentImports, audit] = await Promise.all([
    db.select({ id: schema.users.id, email: schema.users.email, displayName: schema.users.displayName, role: schema.organizationMembers.role })
      .from(schema.organizationMembers).innerJoin(schema.users, eq(schema.users.id, schema.organizationMembers.userId)).where(eq(schema.organizationMembers.organizationId, id)),
    db.select({ value: count() }).from(schema.contacts).where(eq(schema.contacts.organizationId, id)),
    db.select({ value: count() }).from(schema.campaigns).where(eq(schema.campaigns.organizationId, id)),
    db.select({ id: schema.whatsappPhoneNumbers.id, verifiedName: schema.whatsappPhoneNumbers.verifiedName, displayPhoneNumber: schema.whatsappPhoneNumbers.displayPhoneNumber, wabaId: schema.whatsappPhoneNumbers.wabaId, status: schema.whatsappPhoneNumbers.status })
      .from(schema.whatsappPhoneNumbers).where(eq(schema.whatsappPhoneNumbers.organizationId, id)),
    db.select({ value: count() }).from(schema.contactImports).where(eq(schema.contactImports.organizationId, id)),
    db.select({ value: count() }).from(schema.suppressionList).where(eq(schema.suppressionList.organizationId, id)),
    db.select({ value: count() }).from(schema.campaignRecipients).where(and(eq(schema.campaignRecipients.organizationId, id), isNotNull(schema.campaignRecipients.submittedAt))),
    db.select({ id: schema.campaigns.id, name: schema.campaigns.name, status: schema.campaigns.status, recipientCount: schema.campaigns.recipientCount, createdAt: schema.campaigns.createdAt })
      .from(schema.campaigns).where(eq(schema.campaigns.organizationId, id)).orderBy(desc(schema.campaigns.createdAt)).limit(8),
    db.select({ id: schema.contactImports.id, file: schema.contactImports.originalFileName, status: schema.contactImports.status, importedRows: schema.contactImports.importedRows, error: schema.contactImports.errorMessage, createdAt: schema.contactImports.createdAt })
      .from(schema.contactImports).where(eq(schema.contactImports.organizationId, id)).orderBy(desc(schema.contactImports.createdAt)).limit(8),
    db.select({ id: schema.platformAuditEvents.id, action: schema.platformAuditEvents.action, metadata: schema.platformAuditEvents.metadata, createdAt: schema.platformAuditEvents.createdAt })
      .from(schema.platformAuditEvents).where(eq(schema.platformAuditEvents.organizationId, id)).orderBy(desc(schema.platformAuditEvents.createdAt)).limit(12),
  ]);

  return <>
    <header className="admin-header"><div><Link href="/admin/organizations">← Organizations</Link><h1>{organization.name}</h1><p>{organization.slug} · created {organization.createdAt.toLocaleDateString()}</p></div><AdminBadge tone={organization.status === "suspended" ? "bad" : "good"}>{organization.status ?? "active"}</AdminBadge></header>
    <div className="admin-grid">
      <AdminMetric label="Users" value={members.length} /><AdminMetric label="Contacts" value={contacts[0]?.value ?? 0} /><AdminMetric label="Campaigns" value={campaigns[0]?.value ?? 0} /><AdminMetric label="WhatsApp numbers" value={numbers.length} />
      <AdminMetric label="Imports" value={imports[0]?.value ?? 0} /><AdminMetric label="Suppressions" value={suppressions[0]?.value ?? 0} /><AdminMetric label="Messages submitted" value={messageUsage[0]?.value ?? 0} /><AdminMetric label="Plan" value={organization.plan ?? "standard"} /><AdminMetric label="WABAs" value={new Set(numbers.map((number) => number.wabaId)).size} />
    </div>

    <div className="admin-two">
      <AdminSection title="Plan and limits">
        <form className="admin-form" action={updateOrganizationPlanAction}>
          <input type="hidden" name="organizationId" value={id} />
          <div className="admin-form-row"><label>Plan<input name="plan" defaultValue={organization.plan ?? "standard"} required /></label><label>Contact limit<input name="contactLimit" type="number" min="1" defaultValue={organization.contactLimit ?? ""} /></label><label>Campaign recipient limit<input name="campaignRecipientLimit" type="number" min="1" defaultValue={organization.campaignRecipientLimit ?? ""} /></label></div>
          <label>Monthly message limit<input name="monthlyMessageLimit" type="number" min="1" defaultValue={organization.monthlyMessageLimit ?? ""} /></label>
          <div><button className="admin-button" type="submit">Save plan / limits</button></div>
        </form>
      </AdminSection>
      <AdminSection title="Organization status">
        {organization.status === "suspended" ? <>
          <p>Suspended {organization.suspendedAt?.toLocaleString() ?? ""}. {organization.suspendedReason}</p>
          <form action={reactivateOrganizationAction}><input type="hidden" name="organizationId" value={id} /><button className="admin-button" type="submit">Reactivate organization</button></form>
        </> : <form className="admin-form" action={suspendOrganizationAction}><input type="hidden" name="organizationId" value={id} /><label>Reason<textarea name="reason" placeholder="Reason for suspension" /></label><div><button className="admin-button admin-button-danger" type="submit">Suspend organization</button></div></form>}
      </AdminSection>
    </div>

    <AdminSection title="Users"><table className="admin-table"><thead><tr><th>Name</th><th>Email</th><th>Workspace role</th></tr></thead><tbody>{members.map((member) => <tr key={member.id}><td>{member.displayName ?? "—"}</td><td>{member.email}</td><td><AdminBadge>{member.role}</AdminBadge></td></tr>)}</tbody></table></AdminSection>
    <AdminSection title="WhatsApp numbers"><table className="admin-table"><thead><tr><th>Number</th><th>Name</th><th>WABA</th><th>Status</th></tr></thead><tbody>{numbers.map((number) => <tr key={number.id}><td>{number.displayPhoneNumber ?? "—"}</td><td>{number.verifiedName ?? "—"}</td><td>{number.wabaId}</td><td><AdminBadge tone={number.status === "connected" ? "good" : "warn"}>{number.status}</AdminBadge></td></tr>)}</tbody></table></AdminSection>
    <div className="admin-two">
      <AdminSection title="Recent campaigns"><table className="admin-table"><thead><tr><th>Campaign</th><th>Status</th><th>Recipients</th></tr></thead><tbody>{recentCampaigns.map((campaign) => <tr key={campaign.id}><td><Link href={`/admin/campaigns?campaignId=${campaign.id}`}>{campaign.name}</Link></td><td>{campaign.status}</td><td>{campaign.recipientCount.toLocaleString()}</td></tr>)}</tbody></table></AdminSection>
      <AdminSection title="Recent imports"><table className="admin-table"><thead><tr><th>File</th><th>Status</th><th>Imported</th></tr></thead><tbody>{recentImports.map((item) => <tr key={item.id}><td><Link href={`/admin/imports?importId=${item.id}`}>{item.file}</Link></td><td>{item.status}</td><td>{item.importedRows.toLocaleString()}</td></tr>)}</tbody></table></AdminSection>
    </div>
    <AdminSection title="Audit events"><table className="admin-table"><thead><tr><th>Action</th><th>Metadata</th><th>Time</th></tr></thead><tbody>{audit.map((event) => <tr key={event.id}><td>{event.action}</td><td><code>{JSON.stringify(event.metadata)}</code></td><td>{event.createdAt.toLocaleString()}</td></tr>)}</tbody></table></AdminSection>
  </>;
}
