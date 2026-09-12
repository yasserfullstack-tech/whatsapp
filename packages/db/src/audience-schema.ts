import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { contacts, organizations } from "./schema";

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export type AudienceFilter =
  | { field: "list"; operator: "in"; value: string }
  | { field: "display_name"; operator: "contains" | "starts_with" | "equals" | "is_empty"; value?: string }
  | { field: "phone_e164"; operator: "starts_with" | "ends_with" | "equals"; value: string };

export type SegmentDefinition = {
  match: "all" | "any";
  filters: AudienceFilter[];
};

export type CampaignAudienceDefinition =
  | { type: "all" }
  | { type: "list"; listId: string }
  | { type: "segment"; match: "all" | "any"; filters: AudienceFilter[] };

export const contactLists = pgTable(
  "contact_lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("contact_lists_org_name_uq").on(table.organizationId, table.name),
    index("contact_lists_org_created_idx").on(table.organizationId, table.createdAt),
  ],
);

export const contactListMembers = pgTable(
  "contact_list_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    listId: uuid("list_id").notNull().references(() => contactLists.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    createdAt,
  },
  (table) => [
    uniqueIndex("contact_list_members_list_contact_uq").on(table.listId, table.contactId),
    index("contact_list_members_org_list_idx").on(table.organizationId, table.listId),
    index("contact_list_members_contact_idx").on(table.contactId),
  ],
);

export const audienceSegments = pgTable(
  "audience_segments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    match: text("match").$type<"all" | "any">().notNull().default("all"),
    filters: jsonb("filters").$type<AudienceFilter[]>().notNull().default([]),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("audience_segments_org_name_uq").on(table.organizationId, table.name),
    index("audience_segments_org_created_idx").on(table.organizationId, table.createdAt),
  ],
);
