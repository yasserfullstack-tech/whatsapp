import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations, users } from "./schema";

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const notificationChannel = pgEnum("notification_channel", ["in_app", "email"]);
export const notificationDeliveryStatus = pgEnum("notification_delivery_status", [
  "pending",
  "sent",
  "failed",
  "dead_letter",
  "suppressed",
]);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    link: text("link"),
    dedupeKey: text("dedupe_key").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt,
  },
  (table) => [
    uniqueIndex("notifications_org_user_dedupe_uq").on(table.organizationId, table.userId, table.dedupeKey),
    index("notifications_user_unread_idx").on(table.organizationId, table.userId, table.readAt, table.createdAt),
    index("notifications_org_created_idx").on(table.organizationId, table.createdAt),
    index("notifications_type_idx").on(table.type),
  ],
);

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    inAppEnabled: boolean("in_app_enabled").notNull().default(true),
    emailEnabled: boolean("email_enabled").notNull().default(true),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("notification_preferences_org_user_type_uq").on(table.organizationId, table.userId, table.type),
    index("notification_preferences_user_idx").on(table.organizationId, table.userId),
  ],
);

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    notificationId: uuid("notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channel: notificationChannel("channel").notNull(),
    status: notificationDeliveryStatus("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    error: text("error"),
    providerMessageId: text("provider_message_id"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("notification_deliveries_notification_channel_uq").on(table.notificationId, table.channel),
    index("notification_deliveries_retry_idx").on(table.channel, table.status, table.nextRetryAt),
    index("notification_deliveries_user_idx").on(table.organizationId, table.userId, table.createdAt),
  ],
);
