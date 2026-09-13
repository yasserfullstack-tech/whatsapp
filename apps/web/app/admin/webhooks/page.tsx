import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { schema } from "@wa/db";
import { AdminBadge, AdminSection } from "@/components/admin-ui";
import { retryWebhookEventAction } from "@/lib/webhook-admin-actions";
import { db } from "@/lib/server";

type PageProps = { searchParams: Promise<{ eventId?: string }> };

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
  const { eventId } = await searchParams;
  const events = await db
    .select({
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
    })
    .from(schema.webhookEvents)
    .leftJoin(schema.organizations, eq(schema.organizations.id, schema.webhookEvents.organizationId))
    .orderBy(desc(schema.webhookEvents.createdAt))
    .limit(200);

  const selected = events.find((event) => event.id === eventId);
  const backlog = events.filter((event) => !event.processedAt && !event.deadLetteredAt).length;
  const deadLettered = events.filter((event) => event.deadLetteredAt).length;

  return <>
    <header className="admin-header">
      <div>
        <h1>Webhooks</h1>
        <p>Durable Meta webhook inbox, retries, dead-letter events, and safe replay controls.</p>
      </div>
      <div>
        <AdminBadge tone={backlog ? "warn" : "good"}>{backlog} recent unprocessed</AdminBadge>{" "}
        <AdminBadge tone={deadLettered ? "bad" : "good"}>{deadLettered} recent dead-letter</AdminBadge>
      </div>
    </header>

    {selected ? <AdminSection
      title={`Inspect webhook ${selected.eventKey}`}
      action={<Link href="/admin/webhooks">Close inspection</Link>}
    >
      <div className="admin-kv">
        <div><span>Organization</span><strong>{selected.organizationName ?? "Unresolved"}</strong></div>
        <div><span>Phone number ID</span><strong>{selected.phoneNumberId ?? "—"}</strong></div>
        <div><span>Status</span><strong>{statusLabel(selected.processingStatus, selected.processedAt)}</strong></div>
        <div><span>Retry / attempts</span><strong>{selected.processingAttempts}</strong></div>
        <div><span>Event age</span><strong>{eventAge(selected.createdAt)}</strong></div>
        <div><span>Next retry</span><strong>{selected.nextRetryAt?.toLocaleString() ?? "—"}</strong></div>
        <div><span>Processing started</span><strong>{selected.processingStartedAt?.toLocaleString() ?? "—"}</strong></div>
        <div><span>Dead-lettered</span><strong>{selected.deadLetteredAt?.toLocaleString() ?? "No"}</strong></div>
        <div><span>Processed</span><strong>{selected.processedAt?.toLocaleString() ?? "No"}</strong></div>
      </div>

      {selected.lastProcessingError
        ? <p className="admin-error"><strong>Last error:</strong> {selected.lastProcessingError}</p>
        : null}

      {!selected.processedAt && selected.processingStatus !== "processing"
        ? <form action={retryWebhookEventAction}>
            <input type="hidden" name="eventId" value={selected.id} />
            <button type="submit">Retry event safely</button>
          </form>
        : null}

      <h3>Payload</h3>
      <pre className="admin-code">{JSON.stringify(selected.payload, null, 2)}</pre>
    </AdminSection> : null}

    <AdminSection title="Recent durable inbox events">
      <table className="admin-table">
        <thead>
          <tr>
            <th>Event</th>
            <th>Organization</th>
            <th>Phone number ID</th>
            <th>Status</th>
            <th>Attempts</th>
            <th>Last error</th>
            <th>Age</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => <tr key={event.id}>
            <td>{event.eventKey}</td>
            <td>{event.organizationName ?? "—"}</td>
            <td>{event.phoneNumberId ?? "—"}</td>
            <td>
              <AdminBadge tone={statusTone(event.processingStatus, event.processedAt)}>
                {statusLabel(event.processingStatus, event.processedAt)}
              </AdminBadge>
            </td>
            <td>{event.processingAttempts}</td>
            <td className="admin-error">{event.lastProcessingError ?? "—"}</td>
            <td>{eventAge(event.createdAt)}</td>
            <td><Link href={`/admin/webhooks?eventId=${event.id}`}>Inspect</Link></td>
          </tr>)}
        </tbody>
      </table>
    </AdminSection>
  </>;
}
