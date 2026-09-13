import Link from "next/link";
import { count, desc, eq } from "drizzle-orm";
import { schema } from "@wa/db";
import { AdminBadge, AdminSection } from "@/components/admin-ui";
import { db } from "@/lib/server";

export default async function OrganizationsPage() {
  const [organizations, memberCounts, contactCounts, campaignCounts, numberCounts] = await Promise.all([
    db.select({
      id: schema.organizations.id,
      name: schema.organizations.name,
      slug: schema.organizations.slug,
      createdAt: schema.organizations.createdAt,
      status: schema.organizationAdminSettings.status,
      plan: schema.organizationAdminSettings.plan,
    }).from(schema.organizations)
      .leftJoin(schema.organizationAdminSettings, eq(schema.organizationAdminSettings.organizationId, schema.organizations.id))
      .orderBy(desc(schema.organizations.createdAt)),
    db.select({ organizationId: schema.organizationMembers.organizationId, value: count() }).from(schema.organizationMembers).groupBy(schema.organizationMembers.organizationId),
    db.select({ organizationId: schema.contacts.organizationId, value: count() }).from(schema.contacts).groupBy(schema.contacts.organizationId),
    db.select({ organizationId: schema.campaigns.organizationId, value: count() }).from(schema.campaigns).groupBy(schema.campaigns.organizationId),
    db.select({ organizationId: schema.whatsappPhoneNumbers.organizationId, value: count() }).from(schema.whatsappPhoneNumbers).groupBy(schema.whatsappPhoneNumbers.organizationId),
  ]);
  const maps = [memberCounts, contactCounts, campaignCounts, numberCounts].map((rows) => new Map(rows.map((row) => [row.organizationId, row.value])));

  return <>
    <header className="admin-header"><div><h1>Organizations</h1><p>Plans, usage footprint, connection footprint, and account status.</p></div></header>
    <AdminSection title={`${organizations.length.toLocaleString()} organizations`}>
      <table className="admin-table"><thead><tr><th>Organization</th><th>Status</th><th>Plan</th><th>Users</th><th>Contacts</th><th>Campaigns</th><th>Numbers</th><th>Created</th></tr></thead><tbody>
        {organizations.map((org) => <tr key={org.id}>
          <td><Link href={`/admin/organizations/${org.id}`}>{org.name}</Link><br /><small>{org.slug}</small></td>
          <td><AdminBadge tone={org.status === "suspended" ? "bad" : "good"}>{org.status ?? "active"}</AdminBadge></td>
          <td>{org.plan ?? "standard"}</td><td>{maps[0]?.get(org.id) ?? 0}</td><td>{maps[1]?.get(org.id) ?? 0}</td><td>{maps[2]?.get(org.id) ?? 0}</td><td>{maps[3]?.get(org.id) ?? 0}</td><td>{org.createdAt.toLocaleDateString()}</td>
        </tr>)}
      </tbody></table>
    </AdminSection>
  </>;
}
