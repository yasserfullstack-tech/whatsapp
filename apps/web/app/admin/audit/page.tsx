import Link from "next/link";
import { and, count, desc, eq, ilike, or } from "drizzle-orm";
import { schema } from "@wa/db";
import { AdminSection } from "@/components/admin-ui";
import { db } from "@/lib/server";

type PageProps = { searchParams: Promise<{ q?: string; action?: string; page?: string }> };
const PAGE_SIZE = 50;

function pageNumber(value?: string): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export default async function AdminAuditPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const q = (params.q ?? "").trim().slice(0, 160);
  const action = (params.action ?? "").trim().slice(0, 160);
  const page = pageNumber(params.page);
  const filters = [
    action ? eq(schema.platformAuditEvents.action, action) : undefined,
    q ? or(
      ilike(schema.platformAuditEvents.action, `%${q}%`),
      ilike(schema.platformAuditEvents.targetId, `%${q}%`),
      ilike(schema.authUser.email, `%${q}%`),
      ilike(schema.organizations.name, `%${q}%`),
    ) : undefined,
  ].filter(Boolean);
  const where = filters.length ? and(...filters) : undefined;

  const [events, totalRows, actions] = await Promise.all([
    db.select({
      id: schema.platformAuditEvents.id,
      action: schema.platformAuditEvents.action,
      targetType: schema.platformAuditEvents.targetType,
      targetId: schema.platformAuditEvents.targetId,
      metadata: schema.platformAuditEvents.metadata,
      createdAt: schema.platformAuditEvents.createdAt,
      actorEmail: schema.authUser.email,
      organizationName: schema.organizations.name,
    }).from(schema.platformAuditEvents)
      .leftJoin(schema.authUser, eq(schema.authUser.id, schema.platformAuditEvents.actorAuthUserId))
      .leftJoin(schema.organizations, eq(schema.organizations.id, schema.platformAuditEvents.organizationId))
      .where(where)
      .orderBy(desc(schema.platformAuditEvents.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ value: count() }).from(schema.platformAuditEvents)
      .leftJoin(schema.authUser, eq(schema.authUser.id, schema.platformAuditEvents.actorAuthUserId))
      .leftJoin(schema.organizations, eq(schema.organizations.id, schema.platformAuditEvents.organizationId))
      .where(where),
    db.select({ action: schema.platformAuditEvents.action }).from(schema.platformAuditEvents).groupBy(schema.platformAuditEvents.action).orderBy(schema.platformAuditEvents.action),
  ]);

  const total = totalRows[0]?.value ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const query = (nextPage?: number) => {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    if (action) next.set("action", action);
    if (nextPage) next.set("page", String(nextPage));
    return next.toString();
  };
  const exportQuery = query();

  return <>
    <header className="admin-header"><div><h1>Audit</h1><p>Platform-level administrative mutations. Destructive and control-plane actions are recorded here.</p></div><a className="admin-button" href={`/admin/audit/export${exportQuery ? `?${exportQuery}` : ""}`}>Export CSV</a></header>
    <AdminSection title="Filter audit events"><form className="admin-filter" method="get"><label>Search<input name="q" defaultValue={q} placeholder="Action, actor, organization, target" /></label><label>Action<select name="action" defaultValue={action}><option value="">All actions</option>{actions.map((item) => <option key={item.action} value={item.action}>{item.action}</option>)}</select></label><button className="admin-button" type="submit">Apply</button>{q || action ? <Link href="/admin/audit">Clear</Link> : null}</form></AdminSection>
    <AdminSection title={`${total.toLocaleString()} events`}><table className="admin-table"><thead><tr><th>Action</th><th>Actor</th><th>Organization</th><th>Target</th><th>Metadata</th><th>Time</th></tr></thead><tbody>{events.map((event) => <tr key={event.id}><td>{event.action}</td><td>{event.actorEmail ?? "deleted user"}</td><td>{event.organizationName ?? "—"}</td><td>{event.targetType}<br /><small>{event.targetId}</small></td><td><code>{JSON.stringify(event.metadata)}</code></td><td>{event.createdAt.toLocaleString()}</td></tr>)}</tbody></table><div className="admin-pagination"><span>Page {page} of {totalPages}</span><div>{page > 1 ? <Link href={`/admin/audit?${query(page - 1)}`}>← Previous</Link> : null}{page < totalPages ? <Link href={`/admin/audit?${query(page + 1)}`}>Next →</Link> : null}</div></div></AdminSection>
  </>;
}
