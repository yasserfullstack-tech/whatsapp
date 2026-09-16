import Link from "next/link";
import { and, count, desc, eq, ilike, or } from "drizzle-orm";
import { schema } from "@wa/db";
import { AdminBadge, AdminSection } from "@/components/admin-ui";
import { grantPlatformAdminAction, revokePlatformAdminAction } from "@/lib/admin-actions";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { db } from "@/lib/server";

type PageProps = { searchParams: Promise<{ q?: string; page?: string }> };
const PAGE_SIZE = 50;

function pageNumber(value?: string): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export default async function AdminAccessPage({ searchParams }: PageProps) {
  const actor = await requirePlatformAdmin();
  const params = await searchParams;
  const q = (params.q ?? "").trim().slice(0, 160);
  const page = pageNumber(params.page);
  const where = q ? or(ilike(schema.authUser.email, `%${q}%`), ilike(schema.authUser.name, `%${q}%`)) : undefined;

  const [users, totalRows, activeGrantRows] = await Promise.all([
    db.select({
      id: schema.authUser.id,
      name: schema.authUser.name,
      email: schema.authUser.email,
      emailVerified: schema.authUser.emailVerified,
      twoFactorEnabled: schema.authUser.twoFactorEnabled,
      createdAt: schema.authUser.createdAt,
      grantId: schema.platformAdminGrants.id,
      grantSource: schema.platformAdminGrants.source,
      grantCreatedAt: schema.platformAdminGrants.createdAt,
      grantRevokedAt: schema.platformAdminGrants.revokedAt,
    }).from(schema.authUser)
      .leftJoin(schema.platformAdminGrants, eq(schema.platformAdminGrants.authUserId, schema.authUser.id))
      .where(where)
      .orderBy(desc(schema.authUser.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ value: count() }).from(schema.authUser).where(where),
    db.select({ value: count() }).from(schema.platformAdminGrants).where(and(eq(schema.platformAdminGrants.revokedAt, null as never))),
  ]);

  const total = totalRows[0]?.value ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activeGrants = users.filter((user) => user.grantId && !user.grantRevokedAt).length;
  const href = (nextPage: number) => {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    next.set("page", String(nextPage));
    return `/admin/access?${next.toString()}`;
  };

  return <>
    <header className="admin-header"><div><h1>Platform access</h1><p>Platform-admin grants are explicit, revocable, and independent of workspace roles.</p></div><AdminBadge tone="warn">{activeGrantRows[0]?.value ?? activeGrants} active grants</AdminBadge></header>
    <AdminSection title="Find authentication users">
      <form className="admin-filter" method="get"><label>Search<input name="q" defaultValue={q} placeholder="Email or name" /></label><button className="admin-button" type="submit">Search</button>{q ? <Link href="/admin/access">Clear</Link> : null}</form>
    </AdminSection>
    <AdminSection title={`${total.toLocaleString()} authentication users`}>
      <table className="admin-table"><thead><tr><th>User</th><th>Identity assurance</th><th>Platform grant</th><th>Grant source</th><th>Action</th></tr></thead><tbody>{users.map((user) => {
        const active = Boolean(user.grantId && !user.grantRevokedAt);
        const self = user.id === actor.authUserId;
        return <tr key={user.id}>
          <td><strong>{user.name}</strong><br /><small>{user.email}</small></td>
          <td><AdminBadge tone={user.emailVerified ? "good" : "warn"}>{user.emailVerified ? "email verified" : "email unverified"}</AdminBadge>{" "}<AdminBadge tone={user.twoFactorEnabled ? "good" : "neutral"}>{user.twoFactorEnabled ? "2FA enabled" : "2FA off"}</AdminBadge></td>
          <td><AdminBadge tone={active ? "good" : user.grantRevokedAt ? "bad" : "neutral"}>{active ? "active" : user.grantRevokedAt ? "revoked" : "none"}</AdminBadge>{user.grantCreatedAt ? <><br /><small>since {user.grantCreatedAt.toLocaleString()}</small></> : null}</td>
          <td>{user.grantSource ?? "—"}</td>
          <td>{active ? self ? <small>Current administrator</small> : <form action={revokePlatformAdminAction}><input type="hidden" name="authUserId" value={user.id} /><button className="admin-button admin-button-danger" type="submit">Revoke platform admin</button></form> : <form action={grantPlatformAdminAction}><input type="hidden" name="authUserId" value={user.id} /><button className="admin-button" type="submit">{user.grantRevokedAt ? "Restore platform admin" : "Grant platform admin"}</button></form>}</td>
        </tr>;
      })}</tbody></table>
      <div className="admin-pagination"><span>Page {page} of {totalPages}</span><div>{page > 1 ? <Link href={href(page - 1)}>← Previous</Link> : null}{page < totalPages ? <Link href={href(page + 1)}>Next →</Link> : null}</div></div>
    </AdminSection>
  </>;
}
