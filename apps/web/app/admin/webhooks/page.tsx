import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { schema } from "@wa/db";
import { AdminBadge, AdminSection } from "@/components/admin-ui";
import { db, webhookQueue } from "@/lib/server";

type PageProps = { searchParams: Promise<{ eventId?: string }> };

export default async function AdminWebhooksPage({ searchParams }: PageProps) {
  const { eventId } = await searchParams;
  const [events, failedJobs] = await Promise.all([
    db.select({
      id: schema.webhookEvents.id, eventKey: schema.webhookEvents.eventKey, organizationName: schema.organizations.name,
      phoneNumberId: schema.webhookEvents.phoneNumberId, payload: schema.webhookEvents.payload, processedAt: schema.webhookEvents.processedAt, createdAt: schema.webhookEvents.createdAt,
    }).from(schema.webhookEvents).leftJoin(schema.organizations, eq(schema.organizations.id, schema.webhookEvents.organizationId)).orderBy(desc(schema.webhookEvents.createdAt)).limit(150),
    webhookQueue.getFailed(0, 49),
  ]);
  const selected = events.find((event) => event.id === eventId);
  const failedByEvent = new Map(failedJobs.map((job) => [job.data.eventId, job]));
  const backlog = events.filter((event) => !event.processedAt).length;

  return <>
    <header className="admin-header"><div><h1>Webhooks</h1><p>Recent webhook events, processing backlog, and failed BullMQ jobs.</p></div><AdminBadge tone={backlog ? "warn" : "good"}>{backlog} recent unprocessed</AdminBadge></header>
    {selected ? <AdminSection title={`Inspect webhook ${selected.eventKey}`} action={<Link href="/admin/webhooks">Close inspection</Link>}>
      <div className="admin-kv"><div><span>Organization</span><strong>{selected.organizationName ?? "Unresolved"}</strong></div><div><span>Phone number ID</span><strong>{selected.phoneNumberId ?? "—"}</strong></div><div><span>Processed</span><strong>{selected.processedAt?.toLocaleString() ?? "No"}</strong></div></div>
      {failedByEvent.get(selected.id)?.failedReason ? <p className="admin-error"><strong>Queue failure:</strong> {failedByEvent.get(selected.id)?.failedReason}</p> : null}
      <h3>Payload</h3><pre className="admin-code">{JSON.stringify(selected.payload, null, 2)}</pre>
    </AdminSection> : null}
    <AdminSection title="Recent events"><table className="admin-table"><thead><tr><th>Event</th><th>Organization</th><th>Phone number ID</th><th>Status</th><th>Queue error</th><th>Created</th><th></th></tr></thead><tbody>{events.map((event) => { const failed = failedByEvent.get(event.id); return <tr key={event.id}><td>{event.eventKey}</td><td>{event.organizationName ?? "—"}</td><td>{event.phoneNumberId ?? "—"}</td><td><AdminBadge tone={failed ? "bad" : event.processedAt ? "good" : "warn"}>{failed ? "failed" : event.processedAt ? "processed" : "backlog"}</AdminBadge></td><td className="admin-error">{failed?.failedReason ?? "—"}</td><td>{event.createdAt.toLocaleString()}</td><td><Link href={`/admin/webhooks?eventId=${event.id}`}>Inspect</Link></td></tr>; })}</tbody></table></AdminSection>
  </>;
}
