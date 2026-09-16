import Link from "next/link";
import { and, count, desc, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import { schema } from "@wa/db";
import { AdminBadge, AdminSection } from "@/components/admin-ui";
import { db } from "@/lib/server";

type PageProps = { searchParams: Promise<{ q?: string; status?: string; page?: string }> };
const PAGE_SIZE = 50;

function pageNumber(value?: string): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export default async function OrganizationsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const q = (params.q ?? "").trim().slice(0, 160);
  const status = params.status === "active" || params.status === "suspended" ? params.status : "";
  const page = pageNumber(params.page);
  const filters = [
    q ? or(ilike(schema.organizations.name, `%${q}%`), ilike(schema.organizations.slug, `%${q}%`)) : undefined,
    status === "suspended" ? eq(schema.organizationAdminSettings.status, "suspended") : undefined,
    status === "active" ? or(isNull(schema.organizationAdminSettings.status), eq(schema.organizationAdminSettings.status, "active")) : undefined,
  ].filter(Boolean);
  const where = filters.length ? and(...filters) : undefined;

  const [organizations, totalRows] = await Promise.all([
    db.select({
      id: schema.organizations.id,
      name: schema.organizations.name,
      slug: schema.organizations.slug,
      createdAt: schema.organizations.createdAt,
      status: schema.organizationAdminSettings.status,
      plan: schema.organizationAdminSettings.plan,
    }).from(schema.organizations)
      .leftJoin(schema.organizationAdminSettings, eq(schema.organizationAdminSettings.organizationId, schema.organizations.id))
      .where(where)
      .orderBy(desc(schema.organizations.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ value: count() }).from(schema.organizations)
      .leftJoin(schema.organizationAdminSettings, eq(schema.organizationAdminSettings.organizationId, schema.organizations.id))
      .where(where),
  ]);

  const ids = organizations.map((organization) => organization.id);
  const [memberCounts, contactCounts, campaignCounts, numberCounts] = ids.length ? await Promise.all([
    db.select({ organizationId: schema.organizationMembers.organizationId, value: count() }).from(schema.organizationMembers).where(inArray(schema.organizationMembers.organizationId, ids)).groupBy(schema.organizationMembers.organizationId),
    db.select({ organizationId: schema.contacts.organizationId, value: count() }).from(schema.contacts).where(inArray(schema.contacts.organizationId, ids)).groupBy(schema.contacts.organizationId),
    db.select({ organizationId: schema.campaigns.organizationId, value: count() }).from(schema.campaigns).where(inArray(schema.campaigns.organizationId, ids)).groupBy(schema.campaigns.organizationId),
    db.select({ organizationId: schema.whatsappPhoneNumbers.organizationId, value: count() }).from(schema.whatsappPhoneNumbers).where(inArray(schema.whatsappPhoneNumbers.organizationId, ids)).groupBy(schema.whatsappPhoneNumbers.organizationId),
  ]) : [[], [], [], []];
  const maps = [memberCounts, contactCounts, campaignCounts, numberCounts].map((rows) => new Map(rows.map((row) => [row.organizationId, row.value])));
  const total = totalRows[0]?.value ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (nextPage: number) => {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    if (status) next.set("status", status);
    next.set("page", String(nextPage));
    return `/admin/organizations?${next.toString()}`;
  };

  return <>
    <header className="admin-header"><div><h1>Organizations</h1><p>Plans, usage footprint, connection footprint, and account status.</p></div></header>
    <AdminSection title="Filter organizations"><form className="admin-filter" method="get"><label>Search<input name="q" defaultValue={q} placeholder="Name or slug" /></label><label>Status<select name="status" defaultValue={status}><option value="">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option></select></label><button className="admin-button" type="submit">Apply</button>{q || status ? <Link href="/admin/organizations">Clear</Link> : null}</form></AdminSection>
    <AdminSection title={`${total.toLocaleString()} organizations`}>
      <table className="admin-table"><thead><tr><th>Organization</th><th>Status</th><th>Plan</th><th>Users</th><th>Contacts</th><th>Campaigns</th><th>Numbers</th><th>Created</th></tr></thead><tbody>
        {organizations.map((org) => <tr key={org.id}>
          <td><Link href={`/admin/organizations/${org.id}`}>{org.name}</Link><br /><small>{org.slug}</small></td>
          <td><AdminBadge tone={org.status === "suspended" ? "bad" : "good"}>{org.status ?? "active"}</AdminBadge></td>
          <td>{org.plan ?? "standard"}</td><td>{maps[0]?.get(org.id) ?? 0}</td><td>{maps[1]?.get(org.id) ?? 0}</td><td>{maps[2]?.get(org.id) ?? 0}</td><td>{maps[3]?.get(org.id) ?? 0}</td><td>{org.createdAt.toLocaleDateString()}</td>
        </tr>)}
      </tbody></table>
      <div className="admin-pagination"><span>Page {page} of {totalPages}</span><div>{page > 1 ? <Link href={href(page - 1)}>← Previous</Link> : null}{page < totalPages ? <Link href={href(page + 1)}>Next →</Link> : null}</div></div>
    </AdminSection>
  </>;
}
