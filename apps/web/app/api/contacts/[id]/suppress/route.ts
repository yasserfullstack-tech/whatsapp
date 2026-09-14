import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { schema } from "@wa/db";
import { getAuthContext } from "@/lib/auth-context";
import { db } from "@/lib/server";
import { can } from "@/lib/workspace-access";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const requestSchema = z.object({
  reason: z.string().trim().min(3).max(240).default("Manually suppressed from Contacts"),
});

export async function POST(request: Request, routeContext: RouteContext) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(context.workspace.role, "contacts.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid suppression request", issues: parsed.error.issues }, { status: 400 });
  }

  const { id } = await routeContext.params;
  const organizationId = context.workspace.organizationId;
  const [contact] = await db
    .select({ id: schema.contacts.id, phoneE164: schema.contacts.phoneE164 })
    .from(schema.contacts)
    .where(and(eq(schema.contacts.id, id), eq(schema.contacts.organizationId, organizationId)))
    .limit(1);

  if (!contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .insert(schema.suppressionList)
      .values({
        organizationId,
        phoneE164: contact.phoneE164,
        reason: parsed.data.reason,
        source: "dashboard_manual",
        suppressedAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.suppressionList.organizationId, schema.suppressionList.phoneE164],
        set: {
          reason: parsed.data.reason,
          source: "dashboard_manual",
          sourceMessageId: null,
          suppressedAt: now,
          updatedAt: now,
        },
      });

    await tx.update(schema.contacts)
      .set({ optedIn: false, unsubscribedAt: now, updatedAt: now })
      .where(and(eq(schema.contacts.id, contact.id), eq(schema.contacts.organizationId, organizationId)));

    await tx.insert(schema.contactConsentEvents).values({
      organizationId,
      contactId: contact.id,
      phoneE164: contact.phoneE164,
      eventType: "manual_suppression",
      source: "dashboard_manual",
      note: parsed.data.reason,
      actorUserId: context.workspace.userId,
      occurredAt: now,
    });

    await tx.update(schema.campaignRecipients)
      .set({
        status: "skipped",
        errorCode: "SUPPRESSED",
        lastError: "Recipient manually suppressed from Contacts",
        updatedAt: now,
      })
      .where(and(
        eq(schema.campaignRecipients.organizationId, organizationId),
        eq(schema.campaignRecipients.phoneE164, contact.phoneE164),
        inArray(schema.campaignRecipients.status, ["pending", "queued"]),
      ));
  });

  return NextResponse.json({ status: "suppressed", phoneE164: contact.phoneE164 });
}
