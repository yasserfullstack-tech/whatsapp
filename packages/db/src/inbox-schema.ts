import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  contacts,
  organizations,
  users,
  webhookEvents,
  whatsappPhoneNumbers,
} from "./schema";

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const inboxConversationStatus = pgEnum("inbox_conversation_status", ["open", "closed"]);
export const inboxMessageDirection = pgEnum("inbox_message_direction", ["inbound", "outbound"]);
export const inboxMessageSource = pgEnum("inbox_message_source", ["inbound", "agent_reply", "campaign"]);
export const inboxMessageType = pgEnum("inbox_message_type", [
  "text",
  "button",
  "interactive",
  "image",
  "video",
  "audio",
  "document",
  "sticker",
  "other",
]);
export const inboxMessageStatus = pgEnum("inbox_message_status", [
  "received",
  "pending",
  "submitted",
  "sent",
  "delivered",
  "read",
  "failed",
]);

export const inboxConversations = pgTable(
  "inbox_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    whatsappPhoneNumberId: uuid("whatsapp_phone_number_id")
      .notNull()
      .references(() => whatsappPhoneNumbers.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    customerPhoneE164: text("customer_phone_e164").notNull(),
    customerDisplayName: text("customer_display_name"),
    assignedUserId: uuid("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
    status: inboxConversationStatus("status").notNull().default("open"),
    unreadCount: integer("unread_count").notNull().default(0),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    lastOutboundAt: timestamp("last_outbound_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("inbox_conversations_scope_uq").on(
      table.organizationId,
      table.whatsappPhoneNumberId,
      table.customerPhoneE164,
    ),
    index("inbox_conversations_org_activity_idx").on(table.organizationId, table.status, table.lastMessageAt),
    index("inbox_conversations_assignment_idx").on(table.organizationId, table.assignedUserId, table.status),
    index("inbox_conversations_unread_idx").on(table.organizationId, table.unreadCount, table.lastMessageAt),
  ],
);

export const inboxMessages = pgTable(
  "inbox_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => inboxConversations.id, { onDelete: "cascade" }),
    whatsappPhoneNumberId: uuid("whatsapp_phone_number_id")
      .notNull()
      .references(() => whatsappPhoneNumbers.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    agentUserId: uuid("agent_user_id").references(() => users.id, { onDelete: "set null" }),
    direction: inboxMessageDirection("direction").notNull(),
    source: inboxMessageSource("source").notNull(),
    messageType: inboxMessageType("message_type").notNull().default("other"),
    status: inboxMessageStatus("status").notNull(),
    wamid: text("wamid"),
    senderPhone: text("sender_phone"),
    recipientPhone: text("recipient_phone"),
    senderDisplayName: text("sender_display_name"),
    recipientDisplayName: text("recipient_display_name"),
    text: text("text"),
    mediaId: text("media_id"),
    mediaMimeType: text("media_mime_type"),
    mediaSha256: text("media_sha256"),
    mediaFileName: text("media_file_name"),
    mediaCaption: text("media_caption"),
    interactivePayload: jsonb("interactive_payload").$type<Record<string, unknown>>(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    providerTimestamp: timestamp("provider_timestamp", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("inbox_messages_org_wamid_uq").on(table.organizationId, table.wamid),
    index("inbox_messages_conversation_time_idx").on(table.conversationId, table.providerTimestamp, table.createdAt),
    index("inbox_messages_org_status_idx").on(table.organizationId, table.status, table.createdAt),
    index("inbox_messages_phone_idx").on(table.organizationId, table.whatsappPhoneNumberId, table.createdAt),
  ],
);

export const inboxNotes = pgTable(
  "inbox_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => inboxConversations.id, { onDelete: "cascade" }),
    authorUserId: uuid("author_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    body: text("body").notNull(),
    createdAt,
  },
  (table) => [index("inbox_notes_conversation_idx").on(table.organizationId, table.conversationId, table.createdAt)],
);

export const inboxWebhookReceipts = pgTable(
  "inbox_webhook_receipts",
  {
    webhookEventId: uuid("webhook_event_id")
      .primaryKey()
      .references(() => webhookEvents.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("inbox_webhook_receipts_org_idx").on(table.organizationId, table.processedAt)],
);
