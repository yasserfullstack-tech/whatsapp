import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { contacts, organizations, users } from "./schema";

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const suppressionList = pgTable(
  "suppression_list",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    phoneE164: text("phone_e164").notNull(),
    reason: text("reason").notNull().default("marketing_opt_out"),
    source: text("source").notNull(),
    sourceMessageId: text("source_message_id"),
    suppressedAt: timestamp("suppressed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("suppression_list_org_phone_uq").on(table.organizationId, table.phoneE164),
    index("suppression_list_org_suppressed_idx").on(table.organizationId, table.suppressedAt),
  ],
);

export const contactConsentEvents = pgTable(
  "contact_consent_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    phoneE164: text("phone_e164").notNull(),
    eventType: text("event_type").notNull(),
    source: text("source").notNull(),
    sourceMessageId: text("source_message_id"),
    note: text("note"),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt,
  },
  (table) => [
    index("contact_consent_events_org_phone_time_idx").on(table.organizationId, table.phoneE164, table.occurredAt),
    index("contact_consent_events_org_type_time_idx").on(table.organizationId, table.eventType, table.occurredAt),
  ],
);
