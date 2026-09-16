import { and, desc, eq, ilike, or } from "drizzle-orm";
import { schema } from "@wa/db";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { db } from "@/lib/server";

function csvCell(value: unknown): string {
  let text = value == null ? "" : value instanceof Date ? value.toISOString() : typeof value === "string" ? value : JSON.stringify(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export async function GET(request: Request) {
  const actor = await requirePlatformAdmin();
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 160);
  const action = (url.searchParams.get("action") ?? "").trim().slice(0, 160);
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

  const events = await db.select({
    id: schema.platformAuditEvents.id,
    action: schema.platformAuditEvents.action,
    actorEmail: schema.authUser.email,
    organizationName: schema.organizations.name,
    targetType: schema.platformAuditEvents.targetType,
    targetId: schema.platformAuditEvents.targetId,
    metadata: schema.platformAuditEvents.metadata,
    createdAt: schema.platformAuditEvents.createdAt,
  }).from(schema.platformAuditEvents)
    .leftJoin(schema.authUser, eq(schema.authUser.id, schema.platformAuditEvents.actorAuthUserId))
    .leftJoin(schema.organizations, eq(schema.organizations.id, schema.platformAuditEvents.organizationId))
    .where(where)
    .orderBy(desc(schema.platformAuditEvents.createdAt))
    .limit(5_000);

  await db.insert(schema.platformAuditEvents).values({
    actorAuthUserId: actor.authUserId,
    action: "audit.exported",
    targetType: "platform_audit_events",
    targetId: "csv",
    metadata: { q: q || null, action: action || null, rowCount: events.length, limit: 5_000 },
  });

  const header = ["id", "action", "actor_email", "organization", "target_type", "target_id", "metadata", "created_at"];
  const rows = events.map((event) => [event.id, event.action, event.actorEmail, event.organizationName, event.targetType, event.targetId, event.metadata, event.createdAt]);
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  const stamp = new Date().toISOString().replaceAll(":", "-");

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="platform-audit-${stamp}.csv"`,
      "cache-control": "no-store",
    },
  });
}
