import Link from "next/link";
import { and, count, desc, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import { schema } from "@wa/db";
import { AdminBadge, AdminSection } from "@/components/admin-ui";
import { setUserDisabledAction } from "@/lib/admin-actions";
import { db } from "@/lib/server";

type PageProps = { searchParams: Promise<{ q?: string; status?: string; page?: string }> };
const PAGE_SIZE = 50;

function pageNumber(value?: string): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export default async function AdminUsersPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const q = (params.q ?? "").trim().slice(0, 160);
  const status = params.status === "active" || params.status === "disabled" ? params.status : "";
  const page = pageNumber(params.page);
  const filters = [
    q ? or(ilike(schema.users.email, `%${q}%`), ilike(schema.users.displayName, `%${q}%`)) : undefined,
    status === "disabled" ? eq(schema.platformUserControls.disabled, true) : undefined,
    status === "active" ? or(isNull(schema.platformUserControls.disabled), eq(schema.platformUserControls.disabled, false)) : undefined,
  ].filter(Boolean);
  const where = filters.length ? and(...filters) : undefined;

  const [users, totalRows] = await Promise.all([
    db.select({
      id: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      createdAt: schema.users.createdAt,
      disabled: schema.platformUserControls.disabled,
      disabledReason: schema.platformUserControls.disabledReason,
    }).from(schema.users)
      .leftJoin(schema.platformUserControls, eq(schema.platformUserControls.userId, schema.users.id))
      .where(where)
      .orderBy(desc(schema.users.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ value: count() }).from(schema.users)
      .leftJoin(schema.platformUserControls, eq(schema.platformUserControls.userId, schema.users.id))
      .where(where),
  ]);

  const ids = users.map((user) => user.id);
  const memberships = ids.length ? await db.select({
    userId: schema.organizationMembers.userId,
    organizationId: schema.organizationMembers.organizationId,
    organizationName: schema.organizations.name,
    role: schema.organizationMembers.role,
  }).from(schema.organizationMembers)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.organizationMembers.organizationId))
    .where(inArray(schema.organizationMembers.userId, ids)) : [];
  const membershipMap = new Map<string, typeof memberships>();
  for (const membership of memberships) {
    const rows = membershipMap.get(membership.userId) ?? [];
    rows.push(membership);
    membershipMap.set(membership.userId, rows);
  }

  const total = totalRows[0]?.value ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (nextPage: number) => {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    if (status) next.set("status", status);
    next.set("page", String(nextPage));
    return `/admin/users?${next.toString()}`;
  };

  return <>
    <header className="admin-header"><div><h1>Users</h1><p>Customer application users. Platform-admin grants are separate and are not inferred from workspace roles.</p></div><Link href="/admin/access">Manage platform access →</Link></header>
    <AdminSection title="Filter users"><form className="admin-filter" method="get"><label>Search<input name="q" defaultValue={q} placeholder="Email or display name" /></label><label>Status<select name="status" defaultValue={status}><option value="">All statuses</option><option value="active">Active</option><option value="disabled">Disabled</option></select></label><button className="admin-button" type="submit">Apply</button>{q || status ? <Link href="/admin/users">Clear</Link> : null}</form></AdminSection>
    <AdminSection title={`${total.toLocaleString()} users`}>
      <table className="admin-table"><thead><tr><th>User</th><th>Memberships</th><th>Status</th><th>Action</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}>
        <td><strong>{user.displayName ?? "—"}</strong><br /><small>{user.email}</small></td>
        <td>{(membershipMap.get(user.id) ?? []).length ? (membershipMap.get(user.id) ?? []).map((membership) => <div key={membership.organizationId}><Link href={`/admin/organizations/${membership.organizationId}`}>{membership.organizationName}</Link> · {membership.role}</div>) : "—"}</td>
        <td><AdminBadge tone={user.disabled ? "bad" : "good"}>{user.disabled ? "disabled" : "active"}</AdminBadge>{user.disabledReason ? <><br /><small>{user.disabledReason}</small></> : null}</td>
        <td><form className="admin-actions" action={setUserDisabledAction}><input type="hidden" name="userId" value={user.id} /><input type="hidden" name="disabled" value={user.disabled ? "false" : "true"} />{user.disabled ? null : <input name="reason" aria-label="Disable reason" placeholder="Reason" />}<button className={`admin-button ${user.disabled ? "admin-button-secondary" : "admin-button-danger"}`} type="submit">{user.disabled ? "Re-enable" : "Disable user"}</button></form></td>
      </tr>)}</tbody></table>
      <div className="admin-pagination"><span>Page {page} of {totalPages}</span><div>{page > 1 ? <Link href={href(page - 1)}>← Previous</Link> : null}{page < totalPages ? <Link href={href(page + 1)}>Next →</Link> : null}</div></div>
    </AdminSection>
  </>;
}
