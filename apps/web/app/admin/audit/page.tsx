import { desc, eq } from "drizzle-orm";
import { schema } from "@wa/db";
import { AdminSection } from "@/components/admin-ui";
import { db } from "@/lib/server";

export default async function AdminAuditPage() {
  const events = await db.select({
    id: schema.platformAuditEvents.id, action: schema.platformAuditEvents.action, targetType: schema.platformAuditEvents.targetType,
    targetId: schema.platformAuditEvents.targetId, metadata: schema.platformAuditEvents.metadata, createdAt: schema.platformAuditEvents.createdAt,
    actorEmail: schema.authUser.email, organizationName: schema.organizations.name,
  }).from(schema.platformAuditEvents)
    .leftJoin(schema.authUser, eq(schema.authUser.id, schema.platformAuditEvents.actorAuthUserId))
    .leftJoin(schema.organizations, eq(schema.organizations.id, schema.platformAuditEvents.organizationId))
    .orderBy(desc(schema.platformAuditEvents.createdAt)).limit(300);

  return <>
    <header className="admin-header"><div><h1>Audit</h1><p>Platform-level administrative mutations. Destructive and control-plane actions are recorded here.</p></div></header>
    <AdminSection title={`${events.length} recent events`}><table className="admin-table"><thead><tr><th>Action</th><th>Actor</th><th>Organization</th><th>Target</th><th>Metadata</th><th>Time</th></tr></thead><tbody>{events.map((event) => <tr key={event.id}><td>{event.action}</td><td>{event.actorEmail ?? "deleted user"}</td><td>{event.organizationName ?? "—"}</td><td>{event.targetType}<br /><small>{event.targetId}</small></td><td><code>{JSON.stringify(event.metadata)}</code></td><td>{event.createdAt.toLocaleString()}</td></tr>)}</tbody></table></AdminSection>
  </>;
}
