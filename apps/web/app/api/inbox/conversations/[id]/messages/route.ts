import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { decryptSecret } from "@wa/credentials";
import { MetaApiError } from "@wa/meta";
import { sendWhatsAppText } from "@wa/meta/messages";
import { schema } from "@wa/db";
import { getAuthContext } from "@/lib/auth-context";
import { canSendAgentReply } from "@/lib/inbox";
import { db, getCredentialKeyRing, getMetaServerConfig } from "@/lib/server";
import { can } from "@/lib/workspace-access";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };
const requestSchema = z.object({ text: z.string().trim().min(1).max(4_096) });

function safeSendError(error: unknown): string {
  if (error instanceof MetaApiError) return `Meta rejected the reply (${error.status})`;
  return "The reply could not be submitted to WhatsApp";
}

export async function POST(request: Request, routeContext: RouteContext) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(context.workspace.role, "inbox.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid reply", issues: parsed.error.issues }, { status: 400 });
  }

  const { id } = await routeContext.params;
  const organizationId = context.workspace.organizationId;
  const row = (
    await db
      .select({
        conversationId: schema.inboxConversations.id,
        conversationStatus: schema.inboxConversations.status,
        customerPhoneE164: schema.inboxConversations.customerPhoneE164,
        customerDisplayName: schema.inboxConversations.customerDisplayName,
        lastInboundAt: schema.inboxConversations.lastInboundAt,
        whatsappPhoneNumberId: schema.whatsappPhoneNumbers.id,
        metaPhoneNumberId: schema.whatsappPhoneNumbers.phoneNumberId,
        businessPhone: schema.whatsappPhoneNumbers.displayPhoneNumber,
        businessName: schema.whatsappPhoneNumbers.verifiedName,
        connectionStatus: schema.whatsappPhoneNumbers.status,
        reauthorizationRequired: schema.whatsappPhoneNumbers.reauthorizationRequired,
        credentialKey: schema.whatsappPhoneNumbers.credentialKey,
      })
      .from(schema.inboxConversations)
      .innerJoin(
        schema.whatsappPhoneNumbers,
        eq(schema.whatsappPhoneNumbers.id, schema.inboxConversations.whatsappPhoneNumberId),
      )
      .where(and(
        eq(schema.inboxConversations.id, id),
        eq(schema.inboxConversations.organizationId, organizationId),
      ))
      .limit(1)
  )[0];

  if (!row) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  if (row.conversationStatus === "closed") {
    return NextResponse.json({ error: "Reopen the conversation before replying" }, { status: 409 });
  }
  if (!canSendAgentReply(row.lastInboundAt)) {
    return NextResponse.json({ error: "The 24-hour WhatsApp customer service window has closed. Use an approved template campaign instead." }, { status: 409 });
  }
  if (row.connectionStatus !== "connected" || row.reauthorizationRequired) {
    return NextResponse.json({ error: "Reconnect WhatsApp before replying" }, { status: 409 });
  }

  const secret = (
    await db
      .select({
        ciphertext: schema.credentialSecrets.ciphertext,
        iv: schema.credentialSecrets.iv,
        authTag: schema.credentialSecrets.authTag,
      })
      .from(schema.credentialSecrets)
      .where(and(
        eq(schema.credentialSecrets.organizationId, organizationId),
        eq(schema.credentialSecrets.key, row.credentialKey),
      ))
      .limit(1)
  )[0];
  if (!secret) return NextResponse.json({ error: "WhatsApp credential is unavailable" }, { status: 409 });

  const [pending] = await db
    .insert(schema.inboxMessages)
    .values({
      organizationId,
      conversationId: row.conversationId,
      whatsappPhoneNumberId: row.whatsappPhoneNumberId,
      agentUserId: context.workspace.userId,
      direction: "outbound",
      source: "agent_reply",
      messageType: "text",
      status: "pending",
      senderPhone: row.businessPhone,
      recipientPhone: row.customerPhoneE164,
      senderDisplayName: row.businessName,
      recipientDisplayName: row.customerDisplayName,
      text: parsed.data.text,
      providerTimestamp: new Date(),
    })
    .returning({ id: schema.inboxMessages.id });
  if (!pending) return NextResponse.json({ error: "Could not create reply" }, { status: 500 });

  try {
    const accessToken = decryptSecret(secret, getCredentialKeyRing());
    const meta = getMetaServerConfig();
    const sent = await sendWhatsAppText({
      phoneNumberId: row.metaPhoneNumberId,
      to: row.customerPhoneE164,
      text: parsed.data.text,
      accessToken,
      graphApiVersion: meta.graphApiVersion,
    });
    const now = new Date();

    await db.transaction(async (tx) => {
      await tx
        .update(schema.inboxMessages)
        .set({
          wamid: sent.messageId,
          status: "submitted",
          submittedAt: now,
          providerTimestamp: now,
          updatedAt: now,
        })
        .where(and(
          eq(schema.inboxMessages.id, pending.id),
          eq(schema.inboxMessages.organizationId, organizationId),
        ));
      await tx
        .update(schema.inboxConversations)
        .set({ lastMessageAt: now, lastOutboundAt: now, updatedAt: now })
        .where(and(
          eq(schema.inboxConversations.id, row.conversationId),
          eq(schema.inboxConversations.organizationId, organizationId),
        ));
    });

    return NextResponse.json({ message: { id: pending.id, wamid: sent.messageId, status: "submitted" } }, { status: 201 });
  } catch (error) {
    const failedAt = new Date();
    const errorMessage = safeSendError(error);
    await db
      .update(schema.inboxMessages)
      .set({ status: "failed", failedAt, errorMessage, updatedAt: failedAt })
      .where(and(
        eq(schema.inboxMessages.id, pending.id),
        eq(schema.inboxMessages.organizationId, organizationId),
      ));
    return NextResponse.json({ error: errorMessage }, { status: 502 });
  }
}
