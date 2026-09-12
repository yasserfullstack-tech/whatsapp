import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { schema } from "@wa/db";
import { getAuthContext } from "@/lib/auth-context";
import { db } from "@/lib/server";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const requestSchema = z.object({
  consentSource: z.string().trim().min(3).max(160),
  consentedAt: z.string().datetime(),
  evidenceNote: z.string().trim().min(8).max(1_000),
  confirmation: z.literal(true),
});

export async function POST(request: Request, routeContext: RouteContext) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (context.workspace.role !== "owner" && context.workspace.role !== "admin") {
    return NextResponse.json({ error: "Only workspace owners and admins can restore marketing consent" }, { status: 403 });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "New consent evidence is required", issues: parsed.error.issues }, { status: 400 });
  }

  const consentedAt = new Date(parsed.data.consentedAt);
  if (consentedAt.getTime() > Date.now() + 5 * 60_000) {
    return NextResponse.json({ error: "Consent time cannot be in the future" }, { status: 400 });
  }

  const { id } = await routeContext.params;
  const organizationId = context.workspace.organizationId;
  const [contact] = await db
    .select({
      id: schema.contacts.id,
      phoneE164: schema.contacts.phoneE164,
      optedIn: schema.contacts.optedIn,
      unsubscribedAt: schema.contacts.unsubscribedAt,
    })
    .from(schema.contacts)
    .where(and(eq(schema.contacts.id, id), eq(schema.contacts.organizationId, organizationId)))
    .limit(1);

  if (!contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

  const [activeSuppression] = await db
    .select({ id: schema.suppressionList.id })
    .from(schema.suppressionList)
    .where(and(
      eq(schema.suppressionList.organizationId, organizationId),
      eq(schema.suppressionList.phoneE164, contact.phoneE164),
    ))
    .limit(1);

  if (contact.optedIn && !contact.unsubscribedAt && !activeSuppression) {
    return NextResponse.json({ error: "Contact is already marketing-eligible" }, { status: 409 });
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.delete(schema.suppressionList)
      .where(and(
        eq(schema.suppressionList.organizationId, organizationId),
        eq(schema.suppressionList.phoneE164, contact.phoneE164),
      ));

    await tx.update(schema.contacts)
      .set({
        optedIn: true,
        optInSource: parsed.data.consentSource,
        optInAt: consentedAt,
        unsubscribedAt: null,
        updatedAt: now,
      })
      .where(and(eq(schema.contacts.id, contact.id), eq(schema.contacts.organizationId, organizationId)));

    await tx.insert(schema.contactConsentEvents).values({
      organizationId,
      contactId: contact.id,
      phoneE164: contact.phoneE164,
      eventType: "resubscribe",
      source: parsed.data.consentSource,
      note: parsed.data.evidenceNote,
      actorUserId: context.workspace.userId,
      occurredAt: consentedAt,
    });
  });

  return NextResponse.json({
    status: "eligible",
    phoneE164: contact.phoneE164,
    consentedAt: consentedAt.toISOString(),
  });
}
