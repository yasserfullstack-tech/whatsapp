import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { schema } from "@wa/db";
import { getAuthContext } from "@/lib/auth-context";
import {
  createContactSchema,
  isUniqueViolation,
  normalizeCustomFields,
  normalizeTags,
} from "@/lib/contact-management";
import { db } from "@/lib/server";
import { can } from "@/lib/workspace-access";

export const runtime = "nodejs";

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export async function GET(request: Request) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = context.workspace.organizationId;
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
  const status = url.searchParams.get("status") ?? "all";
  const cursor = (url.searchParams.get("cursor") ?? "").trim();
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 10), 100);

  if (url.searchParams.get("duplicates") === "1") {
    const duplicateRows = await db.execute(sql`
      SELECT lower(btrim(c.display_name)) AS duplicate_key,
        json_agg(json_build_object('id', c.id, 'phoneE164', c.phone_e164, 'displayName', c.display_name) ORDER BY c.phone_e164) AS contacts
      FROM contacts c
      WHERE c.organization_id = ${organizationId}::uuid
        AND coalesce(btrim(c.display_name), '') <> ''
        AND NOT EXISTS (
          SELECT 1 FROM contact_merges cm
          WHERE cm.organization_id = ${organizationId}::uuid AND cm.source_contact_id = c.id
        )
      GROUP BY lower(btrim(c.display_name))
      HAVING count(*) > 1
      ORDER BY count(*) DESC, lower(btrim(c.display_name)) ASC
      LIMIT 20
    `);
    return NextResponse.json({ groups: Array.from(duplicateRows) });
  }

  const predicates = [
    sql`c.organization_id = ${organizationId}::uuid`,
    sql`NOT EXISTS (
      SELECT 1 FROM contact_merges cm
      WHERE cm.organization_id = ${organizationId}::uuid AND cm.source_contact_id = c.id
    )`,
  ];
  if (cursor) predicates.push(sql`c.phone_e164 > ${cursor}`);
  if (query) {
    const pattern = `%${escapeLike(query)}%`;
    predicates.push(sql`(c.phone_e164 ILIKE ${pattern} ESCAPE '\\' OR coalesce(c.display_name, '') ILIKE ${pattern} ESCAPE '\\')`);
  }
  if (status === "eligible") predicates.push(sql`c.opted_in = true AND c.unsubscribed_at IS NULL AND sl.id IS NULL`);
  else if (status === "suppressed") predicates.push(sql`sl.id IS NOT NULL`);
  else if (status === "not_eligible") predicates.push(sql`(c.opted_in = false OR c.unsubscribed_at IS NOT NULL OR sl.id IS NOT NULL)`);

  const rows = await db.execute(sql`
    SELECT
      c.id,
      c.phone_e164 AS "phoneE164",
      c.display_name AS "displayName",
      c.opted_in AS "optedIn",
      c.opt_in_source AS "optInSource",
      c.opt_in_at AS "optInAt",
      c.unsubscribed_at AS "unsubscribedAt",
      sl.suppressed_at AS "suppressedAt",
      sl.reason AS "suppressionReason",
      coalesce((
        SELECT json_agg(ct.tag ORDER BY ct.tag)
        FROM contact_tags ct
        WHERE ct.organization_id = ${organizationId}::uuid AND ct.contact_id = c.id
      ), '[]'::json) AS tags,
      coalesce((
        SELECT jsonb_object_agg(ccf.field_key, ccf.field_value ORDER BY ccf.field_key)
        FROM contact_custom_fields ccf
        WHERE ccf.organization_id = ${organizationId}::uuid AND ccf.contact_id = c.id
      ), '{}'::jsonb) AS "customFields",
      (SELECT count(*)::int FROM contact_notes cn WHERE cn.organization_id = ${organizationId}::uuid AND cn.contact_id = c.id) AS "noteCount"
    FROM contacts c
    LEFT JOIN suppression_list sl
      ON sl.organization_id = c.organization_id AND sl.phone_e164 = c.phone_e164
    WHERE ${sql.join(predicates, sql` AND `)}
    ORDER BY c.phone_e164 ASC
    LIMIT ${limit + 1}
  `);

  const contacts = Array.from(rows);
  const hasMore = contacts.length > limit;
  if (hasMore) contacts.pop();
  const nextCursor = hasMore && contacts.length ? String((contacts.at(-1) as { phoneE164?: string }).phoneE164 ?? "") : null;

  const activities = cursor ? [] : Array.from(await db.execute(sql`
    SELECT cae.id, cae.contact_id AS "contactId", cae.event_type AS "eventType",
      cae.metadata, cae.occurred_at AS "occurredAt", c.phone_e164 AS "phoneE164", NULL::text AS "displayName"
    FROM contact_activity_events cae
    LEFT JOIN contacts c ON c.id = cae.contact_id AND c.organization_id = cae.organization_id
    WHERE cae.organization_id = ${organizationId}::uuid
    ORDER BY cae.occurred_at DESC
    LIMIT 25
  `));

  return NextResponse.json({ contacts, nextCursor, activities });
}

export async function POST(request: Request) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(context.workspace.role, "contacts.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = createContactSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid contact", issues: parsed.error.issues }, { status: 400 });

  const organizationId = context.workspace.organizationId;
  const tags = normalizeTags(parsed.data.tags);
  const customFields = normalizeCustomFields(parsed.data.customFields);

  try {
    const created = await db.transaction(async (tx) => {
      const [contact] = await tx.insert(schema.contacts).values({
        organizationId,
        phoneE164: parsed.data.phoneE164,
        displayName: parsed.data.displayName || null,
        optedIn: false,
      }).returning({ id: schema.contacts.id, phoneE164: schema.contacts.phoneE164, displayName: schema.contacts.displayName });
      if (!contact) throw new Error("Contact insert did not return a row");

      for (const tag of tags) {
        await tx.execute(sql`
          INSERT INTO contact_tags (organization_id, contact_id, tag)
          VALUES (${organizationId}::uuid, ${contact.id}::uuid, ${tag})
          ON CONFLICT (organization_id, contact_id, tag) DO NOTHING
        `);
      }
      for (const [key, value] of Object.entries(customFields)) {
        await tx.execute(sql`
          INSERT INTO contact_custom_fields (organization_id, contact_id, field_key, field_value)
          VALUES (${organizationId}::uuid, ${contact.id}::uuid, ${key}, ${value})
          ON CONFLICT (organization_id, contact_id, field_key)
          DO UPDATE SET field_value = excluded.field_value, updated_at = now()
        `);
      }
      if (parsed.data.note) {
        await tx.execute(sql`
          INSERT INTO contact_notes (organization_id, contact_id, body, created_by_user_id)
          VALUES (${organizationId}::uuid, ${contact.id}::uuid, ${parsed.data.note}, ${context.workspace.userId}::uuid)
        `);
      }
      await tx.execute(sql`
        INSERT INTO contact_activity_events (organization_id, contact_id, event_type, actor_user_id, metadata)
        VALUES (${organizationId}::uuid, ${contact.id}::uuid, 'contact.created', ${context.workspace.userId}::uuid,
          ${JSON.stringify({ source: "manual" })}::jsonb)
      `);
      return contact;
    });

    return NextResponse.json({ contact: created }, { status: 201 });
  } catch (error) {
    if (isUniqueViolation(error)) return NextResponse.json({ error: "A contact with this phone number already exists" }, { status: 409 });
    throw error;
  }
}
