import { index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { webhookEvents } from "./schema";

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const metaAssetWebhookReceipts = pgTable(
  "meta_asset_webhook_receipts",
  {
    eventId: uuid("event_id").notNull().references(() => webhookEvents.id, { onDelete: "cascade" }),
    processingStatus: text("processing_status").notNull().default("pending"),
    processingAttempts: integer("processing_attempts").notNull().default(0),
    lastError: text("last_error"),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.eventId] }),
    index("meta_asset_webhook_receipts_retry_idx").on(table.processingStatus, table.nextRetryAt),
  ],
);

export const metaAssetStateVersions = pgTable(
  "meta_asset_state_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    resourceType: text("resource_type").notNull(),
    resourceKey: text("resource_key").notNull(),
    providerEventAt: timestamp("provider_event_at", { withTimezone: true }).notNull(),
    fingerprint: text("fingerprint").notNull(),
    source: text("source").notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("meta_asset_state_versions_resource_uq").on(table.resourceType, table.resourceKey),
    index("meta_asset_state_versions_provider_event_idx").on(table.providerEventAt),
  ],
);
