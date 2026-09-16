import {
  and,
  asc,
  eq,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";
import { createDatabase, schema } from "@wa/db";
import { parseInboxWebhook, type InboxInboundMessage } from "@wa/meta/inbox";
import type { WhatsAppMessageStatus } from "@wa/meta/webhooks";
import { createLogger } from "@wa/observability";

type Database = ReturnType<typeof createDatabase>["db"];
type InboxStatus = "received" | "pending" | "submitted" | "sent" | "delivered" | "read" | "failed";

const log = createLogger({ service: "inbox-worker" });
const INBOX_BATCH_SIZE = 100;

export function normalizeWhatsappPhone(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  return digits ? `+${digits}` : null;
}

export function inboxMessageStatusAfter(
  current: InboxStatus,
  incoming: WhatsAppMessageStatus["status"],
): InboxStatus {
  if (incoming === "sent") {
    return ["pending", "submitted", "sent"].includes(current) ? "sent" : current;
  }
  if (incoming === "delivered") {
    return ["pending", "submitted", "sent", "delivered"].includes(current) ? "delivered" : current;
  }
  if (incoming === "read") return current === "failed" ? "failed" : "read";
  return current === "delivered" || current === "read" ? current : "failed";
}

function eventTime(timestampSeconds: number | undefined): Date {
  if (timestampSeconds !== undefined) {
    const date = new Date(timestampSeconds * 1_000);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return new Date();
}

function statusFailure(status: WhatsAppMessageStatus): { code: string | null; message: string | null } {
  const error = status.errors[0];
  if (!error) return { code: null, message: null };
  const parts = [error.title, error.message, error.details].filter((value): value is string => Boolean(value));
  return {
    code: error.code ?? null,
    message: parts.length ? parts.join(": ").slice(0, 2_000) : null,
  };
}

async function phoneForMetaId(db: Database, phoneNumberId: string | undefined) {
  if (!phoneNumberId) return null;
  return (
    await db
      .select({
        id: schema.whatsappPhoneNumbers.id,
        organizationId: schema.whatsappPhoneNumbers.organizationId,
        displayPhoneNumber: schema.whatsappPhoneNumbers.displayPhoneNumber,
        verifiedName: schema.whatsappPhoneNumbers.verifiedName,
      })
      .from(schema.whatsappPhoneNumbers)
      .where(eq(schema.whatsappPhoneNumbers.phoneNumberId, phoneNumberId))
      .limit(1)
  )[0] ?? null;
}

async function emitInboundNotification(
  db: Database,
  input: {
    organizationId: string;
    conversationId: string;
    messageId: string;
    senderPhone: string;
    senderName: string | null;
    preview: string | null;
  },
) {
  const [members, localeRow, preferences] = await Promise.all([
    db
      .select({ userId: schema.organizationMembers.userId })
      .from(schema.organizationMembers)
      .where(eq(schema.organizationMembers.organizationId, input.organizationId)),
    db
      .select({ preferredLanguage: schema.workspacePreferences.preferredLanguage })
      .from(schema.workspacePreferences)
      .where(eq(schema.workspacePreferences.organizationId, input.organizationId))
      .limit(1)
      .then((rows) => rows[0]),
    db
      .select({ userId: schema.notificationPreferences.userId, inAppEnabled: schema.notificationPreferences.inAppEnabled })
      .from(schema.notificationPreferences)
      .where(and(
        eq(schema.notificationPreferences.organizationId, input.organizationId),
        eq(schema.notificationPreferences.type, "inbound_message"),
      )),
  ]);

  const disabled = new Set(preferences.filter((item) => !item.inAppEnabled).map((item) => item.userId));
  const locale = localeRow?.preferredLanguage === "ar" ? "ar" : "en";
  const display = input.senderName || input.senderPhone;
  const title = locale === "ar" ? "رسالة واتساب جديدة" : "New WhatsApp message";
  const message = locale === "ar"
    ? `${display} أرسل رسالة جديدة${input.preview ? `: ${input.preview}` : "."}`
    : `${display} sent a new message${input.preview ? `: ${input.preview}` : "."}`;

  for (const member of members) {
    if (disabled.has(member.userId)) continue;
    const [notification] = await db
      .insert(schema.notifications)
      .values({
        organizationId: input.organizationId,
        userId: member.userId,
        type: "inbound_message",
        title,
        message: message.slice(0, 1_000),
        metadata: {
          conversationId: input.conversationId,
          phoneNumber: input.senderPhone,
          senderName: input.senderName,
        },
        link: `/inbox?conversation=${input.conversationId}`,
        dedupeKey: `inbox:${input.messageId}`,
      })
      .onConflictDoNothing({
        target: [schema.notifications.organizationId, schema.notifications.userId, schema.notifications.dedupeKey],
      })
      .returning({ id: schema.notifications.id });
    if (!notification) continue;
    await db
      .insert(schema.notificationDeliveries)
      .values({
        notificationId: notification.id,
        organizationId: input.organizationId,
        userId: member.userId,
        channel: "in_app",
        status: "sent",
        sentAt: new Date(),
      })
      .onConflictDoNothing();
  }
}

async function recordInboundMessage(
  db: Database,
  message: InboxInboundMessage,
  phone: NonNullable<Awaited<ReturnType<typeof phoneForMetaId>>>,
): Promise<{ inserted: boolean; conversationId: string }> {
  const senderPhone = normalizeWhatsappPhone(message.from);
  if (!senderPhone) throw new Error(`Inbound WhatsApp sender is invalid for ${message.messageId}`);
  const at = eventTime(message.timestampSeconds);

  const result = await db.transaction(async (tx) => {
    const contact = (
      await tx
        .select({ id: schema.contacts.id, displayName: schema.contacts.displayName })
        .from(schema.contacts)
        .where(and(
          eq(schema.contacts.organizationId, phone.organizationId),
          eq(schema.contacts.phoneE164, senderPhone),
        ))
        .limit(1)
    )[0] ?? null;

    const [conversation] = await tx
      .insert(schema.inboxConversations)
      .values({
        organizationId: phone.organizationId,
        whatsappPhoneNumberId: phone.id,
        contactId: contact?.id ?? null,
        customerPhoneE164: senderPhone,
        customerDisplayName: message.profileName ?? contact?.displayName ?? null,
        status: "open",
        lastMessageAt: at,
        lastInboundAt: at,
      })
      .onConflictDoUpdate({
        target: [
          schema.inboxConversations.organizationId,
          schema.inboxConversations.whatsappPhoneNumberId,
          schema.inboxConversations.customerPhoneE164,
        ],
        set: {
          contactId: contact?.id ?? sql`${schema.inboxConversations.contactId}`,
          customerDisplayName: message.profileName ?? contact?.displayName ?? sql`${schema.inboxConversations.customerDisplayName}`,
          status: "open",
          closedAt: null,
          lastMessageAt: sql`greatest(${schema.inboxConversations.lastMessageAt}, ${at})`,
          lastInboundAt: sql`greatest(coalesce(${schema.inboxConversations.lastInboundAt}, ${at}), ${at})`,
          updatedAt: new Date(),
        },
      })
      .returning({ id: schema.inboxConversations.id });

    if (!conversation) throw new Error("Could not create or load inbox conversation");

    const [inserted] = await tx
      .insert(schema.inboxMessages)
      .values({
        organizationId: phone.organizationId,
        conversationId: conversation.id,
        whatsappPhoneNumberId: phone.id,
        contactId: contact?.id ?? null,
        direction: "inbound",
        source: "inbound",
        messageType: message.type,
        status: "received",
        wamid: message.messageId,
        senderPhone,
        recipientPhone: message.businessDisplayPhoneNumber ?? phone.displayPhoneNumber,
        senderDisplayName: message.profileName ?? contact?.displayName ?? null,
        recipientDisplayName: phone.verifiedName,
        text: message.text ?? null,
        mediaId: message.media?.id ?? null,
        mediaMimeType: message.media?.mimeType ?? null,
        mediaSha256: message.media?.sha256 ?? null,
        mediaFileName: message.media?.fileName ?? null,
        mediaCaption: message.media?.caption ?? null,
        interactivePayload: message.interactivePayload ?? null,
        providerTimestamp: at,
      })
      .onConflictDoNothing({
        target: [schema.inboxMessages.organizationId, schema.inboxMessages.wamid],
      })
      .returning({ id: schema.inboxMessages.id });

    if (inserted) {
      await tx
        .update(schema.inboxConversations)
        .set({
          unreadCount: sql`${schema.inboxConversations.unreadCount} + 1`,
          updatedAt: new Date(),
        })
        .where(and(
          eq(schema.inboxConversations.id, conversation.id),
          eq(schema.inboxConversations.organizationId, phone.organizationId),
        ));
    }

    return { inserted: Boolean(inserted), conversationId: conversation.id };
  });

  if (result.inserted) {
    await emitInboundNotification(db, {
      organizationId: phone.organizationId,
      conversationId: result.conversationId,
      messageId: message.messageId,
      senderPhone,
      senderName: message.profileName ?? null,
      preview: message.text?.slice(0, 160) ?? message.media?.caption?.slice(0, 160) ?? null,
    });
  }

  return result;
}

async function applyInboxStatus(
  db: Database,
  organizationId: string,
  status: WhatsAppMessageStatus,
): Promise<void> {
  const at = eventTime(status.timestampSeconds).toISOString();

  if (status.status === "sent") {
    await db.execute(sql`
      UPDATE inbox_messages
      SET sent_at = COALESCE(sent_at, ${at}::timestamptz),
          status = CASE WHEN status IN ('pending', 'submitted', 'sent') THEN 'sent'::inbox_message_status ELSE status END,
          updated_at = now()
      WHERE organization_id = ${organizationId}::uuid AND wamid = ${status.wamid}
    `);
    return;
  }
  if (status.status === "delivered") {
    await db.execute(sql`
      UPDATE inbox_messages
      SET delivered_at = COALESCE(delivered_at, ${at}::timestamptz),
          status = CASE WHEN status IN ('pending', 'submitted', 'sent', 'delivered') THEN 'delivered'::inbox_message_status ELSE status END,
          updated_at = now()
      WHERE organization_id = ${organizationId}::uuid AND wamid = ${status.wamid}
    `);
    return;
  }
  if (status.status === "read") {
    await db.execute(sql`
      UPDATE inbox_messages
      SET read_at = COALESCE(read_at, ${at}::timestamptz),
          status = CASE WHEN status <> 'failed' THEN 'read'::inbox_message_status ELSE status END,
          updated_at = now()
      WHERE organization_id = ${organizationId}::uuid AND wamid = ${status.wamid}
    `);
    return;
  }

  const failure = statusFailure(status);
  await db.execute(sql`
    UPDATE inbox_messages
    SET failed_at = COALESCE(failed_at, ${at}::timestamptz),
        error_code = COALESCE(${failure.code}, error_code),
        error_message = COALESCE(${failure.message}, error_message),
        status = CASE WHEN status IN ('delivered', 'read') THEN status ELSE 'failed'::inbox_message_status END,
        updated_at = now()
    WHERE organization_id = ${organizationId}::uuid AND wamid = ${status.wamid}
  `);
}

export async function processInboxWebhookEvent(
  db: Database,
  event: { id: string; payload: unknown },
): Promise<{ messages: number; statuses: number; organizationId: string | null }> {
  const parsed = parseInboxWebhook(event.payload);
  let organizationId: string | null = null;
  let insertedMessages = 0;

  for (const message of parsed.messages) {
    const phone = await phoneForMetaId(db, message.phoneNumberId);
    if (!phone) continue;
    organizationId ??= phone.organizationId;
    const result = await recordInboundMessage(db, message, phone);
    if (result.inserted) insertedMessages += 1;
  }

  for (const status of parsed.statuses) {
    const phone = await phoneForMetaId(db, status.phoneNumberId);
    if (!phone) continue;
    organizationId ??= phone.organizationId;
    await applyInboxStatus(db, phone.organizationId, status);
  }

  await db
    .insert(schema.inboxWebhookReceipts)
    .values({ webhookEventId: event.id, organizationId })
    .onConflictDoNothing({ target: schema.inboxWebhookReceipts.webhookEventId });

  return { messages: insertedMessages, statuses: parsed.statuses.length, organizationId };
}

export async function processPendingInboxWebhooks(db: Database): Promise<number> {
  const events = await db
    .select({ id: schema.webhookEvents.id, payload: schema.webhookEvents.payload })
    .from(schema.webhookEvents)
    .leftJoin(
      schema.inboxWebhookReceipts,
      eq(schema.inboxWebhookReceipts.webhookEventId, schema.webhookEvents.id),
    )
    .where(and(
      isNotNull(schema.webhookEvents.processedAt),
      isNull(schema.inboxWebhookReceipts.webhookEventId),
    ))
    .orderBy(asc(schema.webhookEvents.createdAt))
    .limit(INBOX_BATCH_SIZE);

  let processed = 0;
  for (const event of events) {
    try {
      await processInboxWebhookEvent(db, event);
      processed += 1;
    } catch (error) {
      log.warn("inbox_webhook_processing_failed", { eventId: event.id, error });
    }
  }
  return processed;
}
