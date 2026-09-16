import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { schema } from "@wa/db";
import { getAuthContext } from "@/lib/auth-context";
import { normalizeCustomFields, normalizeTags, updateContactSchema } from "@/lib/contact-management";
import { db } from "@/lib/server";
import { can } from "@/lib/workspace-access";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

async function loadActiveContact(organizationId: string, id: string) {
  const [contact] = await db.select({
    id: schema.contacts.id,
    phoneE164: schema.contacts.phoneE164,
    displayName: schema.contacts.displayName,
    optedIn: schema.contacts.optedIn,
    optInSource: schema.contacts.optInSource,
    optInAt: schema.contacts.optInAt,
    unsubscribedAt: schema.contacts.unsubscribedAt,
  }).from(schema.contacts).where(and(eq(schema.contacts.organizationId, organizationId), eq(schema.contacts.id, id))).limit(1);
  if (!contact) return null;
  const merged = await db.execute(sql`
    SELECT 1 FROM contact_merges
    WHERE organization_id = ${organizationId}::uuid AND source_contact_id = ${id}::uuid
    LIMIT 1
  `);
  return merged.length ? null : contact;
}

export async function GET(_request: Request, routeContext: RouteContext) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await routeContext.params;
  const organizationId = context.workspace.organizationId;
  const contact = await loadActiveContact(organizationId, id);
  if (!contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

  const [tags, fields, notes, activities] = await Promise.all([
    db.execute(sql`SELECT tag FROM contact_tags WHERE organization_id = ${organizationId}::uuid AND contact_id = ${id}::uuid ORDER BY tag`),
    db.execute(sql`SELECT field_key AS "key", field_value AS "value" FROM contact_custom_fields WHERE organization_id = ${organizationId}::uuid AND contact_id = ${id}::uuid ORDER BY field_key`),
    db.execute(sql`SELECT id, body, created_at AS "createdAt", updated_at AS "updatedAt" FROM contact_notes WHERE organization_id = ${organizationId}::uuid AND contact_id = ${id}::uuid ORDER BY created_at DESC LIMIT 100`),
    db.execute(sql`SELECT id, event_type AS "eventType", metadata, occurred_at AS "occurredAt" FROM contact_activity_events WHERE organization_id = ${organizationId}::uuid AND contact_id = ${id}::uuid ORDER BY occurred_at DESC LIMIT 100`),
  ]);

  return NextResponse.json({
    contact,
    tags: Array.from(tags).map((row) => String((row as { tag: string }).tag)),
    customFields: Object.fromEntries(Array.from(fields).map((row) => {
      const item = row as { key: string; value: string };
      return [item.key, item.value];
    })),
    notes: Array.from(notes),
    activities: Array.from(activities),
  });
}

export async function PATCH(request: Request, routeContext: RouteContext) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(context.workspace.role, "contacts.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = updateContactSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid contact update", issues: parsed.error.issues }, { status: 400 });

  const { id } = await routeContext.params;
  const organizationId = context.workspace.organizationId;
  const contact = await loadActiveContact(organizationId, id);
  if (!contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

  const changed: string[] = [];
  await db.transaction(async (tx) => {
    if (parsed.data.displayName !== undefined) {
      await tx.update(schema.contacts).set({ displayName: parsed.data.displayName || null, updatedAt: new Date() })
        .where(and(eq(schema.contacts.organizationId, organizationId), eq(schema.contacts.id, id)));
      changed.push("displayName");
    }

    if (parsed.data.tags !== undefined) {
      const tags = normalizeTags(parsed.data.tags);
      await tx.execute(sql`DELETE FROM contact_tags WHERE organization_id = ${organizationId}::uuid AND contact_id = ${id}::uuid`);
      for (const tag of tags) {
        await tx.execute(sql`INSERT INTO contact_tags (organization_id, contact_id, tag) VALUES (${organizationId}::uuid, ${id}::uuid, ${tag}) ON CONFLICT DO NOTHING`);
      }
      changed.push("tags");
    }

    if (parsed.data.customFields !== undefined) {
      const customFields = normalizeCustomFields(parsed.data.customFields);
      await tx.execute(sql`DELETE FROM contact_custom_fields WHERE organization_id = ${organizationId}::uuid AND contact_id = ${id}::uuid`);
      for (const [key, value] of Object.entries(customFields)) {
        await tx.execute(sql`INSERT INTO contact_custom_fields (organization_id, contact_id, field_key, field_value) VALUES (${organizationId}::uuid, ${id}::uuid, ${key}, ${value})`);
      }
      changed.push("customFields");
    }

    if (parsed.data.note) {
      await tx.execute(sql`
        INSERT INTO contact_notes (organization_id, contact_id, body, created_by_user_id)
        VALUES (${organizationId}::uuid, ${id}::uuid, ${parsed.data.note}, ${context.workspace.userId}::uuid)
      `);
      changed.push("note");
    }

    await tx.execute(sql`
      INSERT INTO contact_activity_events (organization_id, contact_id, event_type, actor_user_id, metadata)
      VALUES (${organizationId}::uuid, ${id}::uuid, 'contact.updated', ${context.workspace.userId}::uuid,
        ${JSON.stringify({ changed })}::jsonb)
    `);
  });

  return NextResponse.json({ status: "updated", id, changed });
}
