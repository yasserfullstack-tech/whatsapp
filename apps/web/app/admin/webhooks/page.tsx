import Link from "next/link";
import { and, count, desc, eq, ilike, isNotNull, isNull, or } from "drizzle-orm";
import { schema } from "@wa/db";
import { AdminBadge, AdminSection } from "@/components/admin-ui";
import { retryWebhookEventAction } from "@/lib/webhook-admin-actions";
import { db } from "@/lib/server";

type PageProps = { searchParams: Promise<{ eventId?: string; q?: string; status?: string; page?: string }> };
const PAGE_SIZE = 50;
const statusFilters = new Set(["unprocessed", "dead_letter", "processed", "processing", "retry"]);

function pageNumber(value?: string): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function eventAge(createdAt: Date): string {
  const seconds = Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function statusTone(status: string, processedAt: Date | null): "good" | "warn" | "bad" {
  if (processedAt || status === "processed") return "good";
  if (status === "dead_letter") return "bad";
  return "warn";
}

function statusLabel(status: string, processedAt: Date | null): string {
  if (processedAt) return "processed";
  return status.replaceAll("_", " ");
}

export default async function AdminWebhooksPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const eventId = params.eventId;
  const q = (params.q ?? "").trim().slice(0, 160);
  const status = statusFilters.has(params.status ?? "") ? params.status ?? "" : "";
  const page = pageNumber(params.page);
  const filters = [
    q ? or(ilike(schema.webhookEvents.eventKey, `%${q}%`), ilike(schema.webhookEvents.phoneNumberId, `%${q}%`), ilike(schema.organizations.name, `%${q}%`)) : undefined,
    status === "unprocessed" ? and(isNull(schema.webhookEvents.processedAt), isNull(schema.webhookEvents.deadLetteredAt)) : undefined,
    status === "dead_letter" ? isNotNull(schema.webhookEvents.deadLetteredAt) : undefined,
    status === "processed" ? isNotNull(schema.webhookEvents.processedAt) : undefined,
    status === "processing" ? eq(schema.webhookEvents.processingStatus, "processing") : undefined,
    status === "retry" ? eq(schema.webhookEvents.processingStatus, "retry") : undefined,
  ].filter(Boolean);
  const where = filters.length ? and(...filters) : undefined;

  const eventSelect = {
    id: schema.webhookEvents.id,
    eventKey: schema.webhookEvents.eventKey,
    organizationName: schema.organizations.name,
    organizationId: schema.webhookEvents.organizationId,
    phoneNumberId: schema.webhookEvents.phoneNumberId,
    payload: schema.webhookEvents.payload,
    processingStatus: schema.webhookEvents.processingStatus,
    processingAttempts: schema.webhookEvents.processingAttempts,
    processingStartedAt: schema.webhookEvents.processingStartedAt,
    lastProcessingError: schema.webhookEvents.lastProcessingError,
    nextRetryAt: schema.webhookEvents.nextRetryAt,
    deadLetteredAt: schema.webhookEvents.deadLetteredAt,
    processedAt: schema.webhookEvents.processedAt,
    createdAt: schema.webhookEvents.createdAt,
  };

  const [events, totalRows, backlogRows, deadLetterRows, selectedRows] = await Promise.all([
    db.select(eventSelect).from(schema.webhookEvents)
      .leftJoin(schema.organizations, eq(schema.organizations.id, schema.webhookEvents.organizationId))
      .where(where)
      .orderBy(desc(schema.webhookEvents.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ value: count() }).from(schema.webhookEvents)
      .leftJoin(schema.organizations, eq(schema.organizations.id, schema.webhookEvents.organizationId))
      .where(where),
    db.select({ value: count() }).from(schema.webhookEvents).where(and(isNull(schema.webhookEvents.processedAt), isNull(schema.webhookEvents.deadLetteredAt))),
    db.select({ value: count() }).from(schema.webhookEvents).where(isNotNull(schema.webhookEvents.deadLetteredAt)),
    eventId ? db.select(eventSelect).from(schema.webhookEvents)
      .leftJoin(schema.organizations, eq(schema.organizations.id, schema.webhookEvents.organizationId))
      .where(eq(schema.webhookEvents.id, eventId)).limit(1) : Promise.resolve([]),
  ]);

  const selected = selectedRows[0];
  const backlog = backlogRows[0]?.value ?? 0;
  const deadLettered = deadLetterRows[0]?.value ?? 0;
  const total = totalRows[0]?.value ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const listQuery = (nextPage?: number) => {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    if (status) next.set("status", status);
    if (nextPage) next.set("page", String(nextPage));
    return next.toString();
  };
  const inspectHref = (id: string) => {
    const next = new URLSearchParams(listQuery(page));
    next.set("eventId", id);
    return `/admin/webhooks?${next.toString()}`;
  };

  return <>
    <header className="admin-header">
      <div><h1>Webhooks</h1><p>Durable Meta webhook inbox, retries, dead-letter events, and safe replay controls.</p></div>
      <div><AdminBadge tone={backlog ? "warn" : "good"}>{backlog.toLocaleString()} unprocessed</AdminBadge>{" "}<AdminBadge tone={deadLettered ? "bad" : "good"}>{deadLettered.toLocaleString()} dead-letter</AdminBadge></div>
    </header>

    <AdminSection title="Filter durable inbox"><form className="admin-filter" method="get"><label>Search<input name="q" defaultValue={q} placeholder="Event key, phone ID, organization" /></label><label>Status<select name="status" defaultValue={status}><option value="">All statuses</option><option value="unprocessed">Unprocessed</option><option value="dead_letter">Dead letter</option><option value="processed">Processed</option><option value="processing">Processing</option><option value="retry">Retry scheduled</option></select></label><button className="admin-button" type="submit">Apply</button>{q || status ? <Link href="/admin/webhooks">Clear</Link> : null}</form></AdminSection>

    {selected ? <AdminSection title={`Inspect webhook ${selected.eventKey}`} action={<Link href={`/admin/webhooks${listQuery(page) ? `?${listQuery(page)}` : ""}`}>Close inspection</Link>}>
      <div className="admin-kv">
        <div><span>Organization</span><strong>{selected.organizationName ?? "Unresolved"}</strong></div><div><span>Phone number ID</span><strong>{selected.phoneNumberId ?? "—"}</strong></div><div><span>Status</span><strong>{statusLabel(selected.processingStatus, selected.processedAt)}</strong></div><div><span>Retry / attempts</span><strong>{selected.processingAttempts}</strong></div><div><span>Event age</span><strong>{eventAge(selected.createdAt)}</strong></div><div><span>Next retry</span><strong>{selected.nextRetryAt?.toLocaleString() ?? "—"}</strong></div><div><span>Processing started</span><strong>{selected.processingStartedAt?.toLocaleString() ?? "—"}</strong></div><div><span>Dead-lettered</span><strong>{selected.deadLetteredAt?.toLocaleString() ?? "No"}</strong></div><div><span>Processed</span><strong>{selected.processedAt?.toLocaleString() ?? "No"}</strong></div>
      </div>
      {selected.lastProcessingError ? <p className="admin-error"><strong>Last error:</strong> {selected.lastProcessingError}</p> : null}
      {!selected.processedAt && selected.processingStatus !== "processing" ? <form action={retryWebhookEventAction}><input type="hidden" name="eventId" value={selected.id} /><button className="admin-button" type="submit">Retry event safely</button></form> : null}
      <h3>Payload</h3><pre className="admin-code">{JSON.stringify(selected.payload, null, 2)}</pre>
    </AdminSection> : null}

    <AdminSection title={`${total.toLocaleString()} matching durable inbox events`}>
      <table className="admin-table"><thead><tr><th>Event</th><th>Organization</th><th>Phone number ID</th><th>Status</th><th>Attempts</th><th>Last error</th><th>Age</th><th></th></tr></thead><tbody>{events.map((event) => <tr key={event.id}><td>{event.eventKey}</td><td>{event.organizationName ?? "—"}</td><td>{event.phoneNumberId ?? "—"}</td><td><AdminBadge tone={statusTone(event.processingStatus, event.processedAt)}>{statusLabel(event.processingStatus, event.processedAt)}</AdminBadge></td><td>{event.processingAttempts}</td><td className="admin-error">{event.lastProcessingError ?? "—"}</td><td>{eventAge(event.createdAt)}</td><td><Link href={inspectHref(event.id)}>Inspect</Link></td></tr>)}</tbody></table>
      <div className="admin-pagination"><span>Page {page} of {totalPages}</span><div>{page > 1 ? <Link href={`/admin/webhooks?${listQuery(page - 1)}`}>← Previous</Link> : null}{page < totalPages ? <Link href={`/admin/webhooks?${listQuery(page + 1)}`}>Next →</Link> : null}</div></div>
    </AdminSection>
  </>;
}
