import { and, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { schema } from "@wa/db";
import { getAuthContext } from "@/lib/auth-context";
import { bulkContactSchema } from "@/lib/contact-management";
import { db } from "@/lib/server";
import { can } from "@/lib/workspace-access";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(context.workspace.role, "contacts.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = bulkContactSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid bulk action", issues: parsed.error.issues }, { status: 400 });

  const organizationId = context.workspace.organizationId;
  const ids = parsed.data.contactIds;
  const contacts = await db.select({ id: schema.contacts.id, phoneE164: schema.contacts.phoneE164 })
    .from(schema.contacts)
    .where(and(eq(schema.contacts.organizationId, organizationId), inArray(schema.contacts.id, ids)));
  if (contacts.length !== ids.length) return NextResponse.json({ error: "One or more contacts were not found in this workspace" }, { status: 404 });

  const idsSql = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
  const mergedRows = await db.execute(sql`
    SELECT source_contact_id FROM contact_merges
    WHERE organization_id = ${organizationId}::uuid AND source_contact_id IN (${idsSql})
    LIMIT 1
  `);
  if (mergedRows.length) return NextResponse.json({ error: "Merged source contacts cannot be modified" }, { status: 409 });

  const now = new Date();
  await db.transaction(async (tx) => {
    if (parsed.data.action === "add_tag" && parsed.data.tag) {
      for (const contact of contacts) {
        await tx.execute(sql`
          INSERT INTO contact_tags (organization_id, contact_id, tag)
          VALUES (${organizationId}::uuid, ${contact.id}::uuid, ${parsed.data.tag})
          ON CONFLICT (organization_id, contact_id, tag) DO NOTHING
        `);
        await tx.execute(sql`
          INSERT INTO contact_activity_events (organization_id, contact_id, event_type, actor_user_id, metadata)
          VALUES (${organizationId}::uuid, ${contact.id}::uuid, 'contact.bulk_tag_added', ${context.workspace.userId}::uuid,
            ${JSON.stringify({ tag: parsed.data.tag })}::jsonb)
        `);
      }
      return;
    }

    if (parsed.data.action === "remove_tag" && parsed.data.tag) {
      for (const contact of contacts) {
        await tx.execute(sql`
          DELETE FROM contact_tags
          WHERE organization_id = ${organizationId}::uuid AND contact_id = ${contact.id}::uuid AND tag = ${parsed.data.tag}
        `);
        await tx.execute(sql`
          INSERT INTO contact_activity_events (organization_id, contact_id, event_type, actor_user_id, metadata)
          VALUES (${organizationId}::uuid, ${contact.id}::uuid, 'contact.bulk_tag_removed', ${context.workspace.userId}::uuid,
            ${JSON.stringify({ tag: parsed.data.tag })}::jsonb)
        `);
      }
      return;
    }

    const reason = parsed.data.reason ?? "Bulk suppression from Contacts";
    for (const contact of contacts) {
      await tx.insert(schema.suppressionList).values({
        organizationId,
        phoneE164: contact.phoneE164,
        reason,
        source: "dashboard_bulk",
        suppressedAt: now,
      }).onConflictDoUpdate({
        target: [schema.suppressionList.organizationId, schema.suppressionList.phoneE164],
        set: { reason, source: "dashboard_bulk", sourceMessageId: null, suppressedAt: now, updatedAt: now },
      });
    }

    await tx.update(schema.contacts).set({ optedIn: false, unsubscribedAt: now, updatedAt: now })
      .where(and(eq(schema.contacts.organizationId, organizationId), inArray(schema.contacts.id, ids)));

    await tx.insert(schema.contactConsentEvents).values(contacts.map((contact) => ({
      organizationId,
      contactId: contact.id,
      phoneE164: contact.phoneE164,
      eventType: "manual_suppression",
      source: "dashboard_bulk",
      note: reason,
      actorUserId: context.workspace.userId,
      occurredAt: now,
    })));

    await tx.update(schema.campaignRecipients).set({
      status: "skipped",
      errorCode: "SUPPRESSED",
      lastError: "Recipient suppressed by a bulk Contacts action",
      updatedAt: now,
    }).where(and(
      eq(schema.campaignRecipients.organizationId, organizationId),
      inArray(schema.campaignRecipients.phoneE164, contacts.map((contact) => contact.phoneE164)),
      inArray(schema.campaignRecipients.status, ["pending", "queued"]),
    ));

    for (const contact of contacts) {
      await tx.execute(sql`
        INSERT INTO contact_activity_events (organization_id, contact_id, event_type, actor_user_id, metadata)
        VALUES (${organizationId}::uuid, ${contact.id}::uuid, 'contact.bulk_suppressed', ${context.workspace.userId}::uuid,
          ${JSON.stringify({ reason })}::jsonb)
      `);
    }
  });

  return NextResponse.json({ status: "ok", affected: contacts.length, action: parsed.data.action });
}
