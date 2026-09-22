import { and, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { schema } from "@wa/db";
import { getAuthContext } from "@/lib/auth-context";
import { isUniqueViolation, mergeContactSchema } from "@/lib/contact-management";
import { db } from "@/lib/server";
import { can } from "@/lib/workspace-access";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(context.workspace.role, "contacts.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = mergeContactSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid merge request", issues: parsed.error.issues }, { status: 400 });

  const organizationId = context.workspace.organizationId;
  const allIds = [parsed.data.targetContactId, ...parsed.data.sourceContactIds];
  const contacts = await db.select({
    id: schema.contacts.id,
    phoneE164: schema.contacts.phoneE164,
    displayName: schema.contacts.displayName,
    optedIn: schema.contacts.optedIn,
    optInSource: schema.contacts.optInSource,
    optInAt: schema.contacts.optInAt,
    unsubscribedAt: schema.contacts.unsubscribedAt,
  }).from(schema.contacts).where(and(eq(schema.contacts.organizationId, organizationId), inArray(schema.contacts.id, allIds)));

  if (contacts.length !== allIds.length) return NextResponse.json({ error: "One or more contacts were not found in this workspace" }, { status: 404 });
  const idsSql = sql.join(allIds.map((id) => sql`${id}::uuid`), sql`, `);
  const mergedRows = await db.execute(sql`
    SELECT source_contact_id FROM contact_merges
    WHERE organization_id = ${organizationId}::uuid AND source_contact_id IN (${idsSql})
    LIMIT 1
  `);
  if (mergedRows.length) return NextResponse.json({ error: "One or more contacts have already been merged" }, { status: 409 });

  const target = contacts.find((contact) => contact.id === parsed.data.targetContactId)!;
  const sources = parsed.data.sourceContactIds.map((id) => contacts.find((contact) => contact.id === id)!);
  const targetSnapshot = {
    id: target.id,
    phoneE164: target.phoneE164,
    displayName: target.displayName,
    optedIn: target.optedIn,
    optInSource: target.optInSource,
    optInAt: target.optInAt?.toISOString() ?? null,
    unsubscribedAt: target.unsubscribedAt?.toISOString() ?? null,
  };

  try {
    await db.transaction(async (tx) => {
      for (const source of sources) {
        const sourceSnapshot = {
          id: source.id,
          phoneE164: source.phoneE164,
          displayName: source.displayName,
          optedIn: source.optedIn,
          optInSource: source.optInSource,
          optInAt: source.optInAt?.toISOString() ?? null,
          unsubscribedAt: source.unsubscribedAt?.toISOString() ?? null,
        };
        await tx.execute(sql`
          INSERT INTO contact_merges (
            organization_id, source_contact_id, target_contact_id, actor_user_id, reason, source_snapshot, target_snapshot
          ) VALUES (
            ${organizationId}::uuid, ${source.id}::uuid, ${target.id}::uuid, ${context.workspace.userId}::uuid,
            ${parsed.data.reason ?? "Manual contact deduplication"}, ${JSON.stringify(sourceSnapshot)}::jsonb, ${JSON.stringify(targetSnapshot)}::jsonb
          )
        `);

        await tx.execute(sql`
          INSERT INTO contact_tags (organization_id, contact_id, tag)
          SELECT organization_id, ${target.id}::uuid, tag
          FROM contact_tags
          WHERE organization_id = ${organizationId}::uuid AND contact_id = ${source.id}::uuid
          ON CONFLICT (organization_id, contact_id, tag) DO NOTHING
        `);
        await tx.execute(sql`
          INSERT INTO contact_custom_fields (organization_id, contact_id, field_key, field_value)
          SELECT organization_id, ${target.id}::uuid, field_key, field_value
          FROM contact_custom_fields
          WHERE organization_id = ${organizationId}::uuid AND contact_id = ${source.id}::uuid
          ON CONFLICT (organization_id, contact_id, field_key) DO NOTHING
        `);
        await tx.execute(sql`
          UPDATE contact_notes SET contact_id = ${target.id}::uuid, updated_at = now()
          WHERE organization_id = ${organizationId}::uuid AND contact_id = ${source.id}::uuid
        `);
        await tx.execute(sql`
          INSERT INTO contact_list_members (organization_id, list_id, contact_id)
          SELECT organization_id, list_id, ${target.id}::uuid
          FROM contact_list_members
          WHERE organization_id = ${organizationId}::uuid AND contact_id = ${source.id}::uuid
          ON CONFLICT (list_id, contact_id) DO NOTHING
        `);
        await tx.execute(sql`
          INSERT INTO contact_activity_events (organization_id, contact_id, event_type, actor_user_id, metadata)
          VALUES (${organizationId}::uuid, ${source.id}::uuid, 'contact.merged_into', ${context.workspace.userId}::uuid,
            ${JSON.stringify({ targetContactId: target.id, targetPhoneE164: target.phoneE164 })}::jsonb)
        `);
      }

      await tx.execute(sql`
        INSERT INTO contact_activity_events (organization_id, contact_id, event_type, actor_user_id, metadata)
        VALUES (${organizationId}::uuid, ${target.id}::uuid, 'contact.merge_completed', ${context.workspace.userId}::uuid,
          ${JSON.stringify({ sourceContactIds: sources.map((source) => source.id), sourcePhones: sources.map((source) => source.phoneE164) })}::jsonb)
      `);
    });
  } catch (error) {
    if (isUniqueViolation(error)) return NextResponse.json({ error: "A source contact was already merged" }, { status: 409 });
    throw error;
  }

  return NextResponse.json({
    status: "merged",
    targetContactId: target.id,
    sourceContactIds: sources.map((source) => source.id),
    consentPreservedPerPhone: true,
  });
}
