import Link from "next/link";
import { and, count, desc, eq, ilike, or } from "drizzle-orm";
import { schema } from "@wa/db";
import { AdminBadge, AdminSection } from "@/components/admin-ui";
import { db } from "@/lib/server";

type ConnectionStatus = "pending" | "connected" | "restricted" | "disconnected";
type HealthStatus = "unknown" | "healthy" | "degraded" | "reauthorization_required";
type PageProps = { searchParams: Promise<{ q?: string; status?: string; health?: string; page?: string }> };
const PAGE_SIZE = 50;
const connectionStatuses = new Set<ConnectionStatus>(["pending", "connected", "restricted", "disconnected"]);
const healthStatuses = new Set<HealthStatus>(["unknown", "healthy", "degraded", "reauthorization_required"]);

function pageNumber(value?: string): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function healthTone(status: HealthStatus): "good" | "warn" | "bad" | "neutral" {
  if (status === "healthy") return "good";
  if (status === "degraded") return "warn";
  if (status === "reauthorization_required") return "bad";
  return "neutral";
}

export default async function AdminConnectionsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const q = (params.q ?? "").trim().slice(0, 160);
  const status = connectionStatuses.has(params.status as ConnectionStatus) ? params.status as ConnectionStatus : "";
  const health = healthStatuses.has(params.health as HealthStatus) ? params.health as HealthStatus : "";
  const page = pageNumber(params.page);
  const filters = [
    q ? or(
      ilike(schema.organizations.name, `%${q}%`),
      ilike(schema.whatsappPhoneNumbers.displayPhoneNumber, `%${q}%`),
      ilike(schema.whatsappPhoneNumbers.verifiedName, `%${q}%`),
      ilike(schema.whatsappPhoneNumbers.wabaId, `%${q}%`),
      ilike(schema.whatsappPhoneNumbers.phoneNumberId, `%${q}%`),
    ) : undefined,
    status ? eq(schema.whatsappPhoneNumbers.status, status) : undefined,
    health ? eq(schema.whatsappPhoneNumbers.healthStatus, health) : undefined,
  ].filter(Boolean);
  const where = filters.length ? and(...filters) : undefined;

  const [connections, totalRows] = await Promise.all([
    db.select({
      id: schema.whatsappPhoneNumbers.id,
      organizationId: schema.whatsappPhoneNumbers.organizationId,
      organizationName: schema.organizations.name,
      wabaId: schema.whatsappPhoneNumbers.wabaId,
      phoneNumberId: schema.whatsappPhoneNumbers.phoneNumberId,
      number: schema.whatsappPhoneNumbers.displayPhoneNumber,
      name: schema.whatsappPhoneNumbers.verifiedName,
      status: schema.whatsappPhoneNumbers.status,
      healthStatus: schema.whatsappPhoneNumbers.healthStatus,
      reauthorizationRequired: schema.whatsappPhoneNumbers.reauthorizationRequired,
      lastValidatedAt: schema.whatsappPhoneNumbers.lastValidatedAt,
      credentialExpiresAt: schema.whatsappPhoneNumbers.credentialExpiresAt,
      failureCode: schema.whatsappPhoneNumbers.failureCode,
      failureReason: schema.whatsappPhoneNumbers.failureReason,
      quality: schema.whatsappPhoneNumbers.qualityRating,
      throughput: schema.whatsappPhoneNumbers.throughputMps,
      updatedAt: schema.whatsappPhoneNumbers.updatedAt,
    }).from(schema.whatsappPhoneNumbers)
      .innerJoin(schema.organizations, eq(schema.organizations.id, schema.whatsappPhoneNumbers.organizationId))
      .where(where)
      .orderBy(desc(schema.whatsappPhoneNumbers.updatedAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ value: count() }).from(schema.whatsappPhoneNumbers)
      .innerJoin(schema.organizations, eq(schema.organizations.id, schema.whatsappPhoneNumbers.organizationId))
      .where(where),
  ]);
  const total = totalRows[0]?.value ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (nextPage: number) => {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    if (status) next.set("status", status);
    if (health) next.set("health", health);
    next.set("page", String(nextPage));
    return `/admin/connections?${next.toString()}`;
  };

  return <>
    <header className="admin-header"><div><h1>Connections</h1><p>Meta connection status, credential health, and reconnect signals across organizations.</p></div></header>
    <AdminSection title="Filter connections"><form className="admin-filter" method="get"><label>Search<input name="q" defaultValue={q} placeholder="Organization, number, WABA, phone ID" /></label><label>Status<select name="status" defaultValue={status}><option value="">All statuses</option>{[...connectionStatuses].map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label>Health<select name="health" defaultValue={health}><option value="">All health states</option>{[...healthStatuses].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label><button className="admin-button" type="submit">Apply</button>{q || status || health ? <Link href="/admin/connections">Clear</Link> : null}</form></AdminSection>
    <AdminSection title={`${total.toLocaleString()} connections`}>
      <table className="admin-table"><thead><tr><th>Organization</th><th>Number</th><th>Meta IDs</th><th>Status</th><th>Health</th><th>Credential / validation</th><th>Failure</th><th>Quality / MPS</th></tr></thead><tbody>{connections.map((connection) => <tr key={connection.id}>
        <td><Link href={`/admin/organizations/${connection.organizationId}`}>{connection.organizationName}</Link></td>
        <td>{connection.name ?? "—"}<br /><small>{connection.number ?? "—"}</small></td>
        <td>WABA {connection.wabaId}<br /><small>phone {connection.phoneNumberId}</small></td>
        <td><AdminBadge tone={connection.status === "connected" ? "good" : connection.status === "restricted" ? "bad" : "warn"}>{connection.status}</AdminBadge></td>
        <td><AdminBadge tone={healthTone(connection.healthStatus)}>{connection.healthStatus.replaceAll("_", " ")}</AdminBadge>{connection.reauthorizationRequired ? <><br /><AdminBadge tone="bad">reconnect required</AdminBadge></> : null}</td>
        <td>validated {connection.lastValidatedAt?.toLocaleString() ?? "never"}<br /><small>credential expires {connection.credentialExpiresAt?.toLocaleString() ?? "unknown"}</small></td>
        <td className={connection.failureReason ? "admin-error" : undefined}>{connection.failureCode ?? "—"}{connection.failureReason ? <><br /><small>{connection.failureReason}</small></> : null}</td>
        <td>{connection.quality ?? "—"}<br /><small>{connection.throughput} MPS</small></td>
      </tr>)}</tbody></table>
      <div className="admin-pagination"><span>Page {page} of {totalPages}</span><div>{page > 1 ? <Link href={href(page - 1)}>← Previous</Link> : null}{page < totalPages ? <Link href={href(page + 1)}>Next →</Link> : null}</div></div>
    </AdminSection>
  </>;
}
