import { index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./schema";
import { contactLists } from "./audience-schema";

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const contactImportStatus = pgEnum("contact_import_status", [
  "awaiting_upload",
  "queued",
  "processing",
  "completed",
  "failed",
]);

export const contactImports = pgTable(
  "contact_imports",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    listId: uuid("list_id").references(() => contactLists.id, { onDelete: "set null" }),
    originalFileName: text("original_file_name").notNull(),
    objectKey: text("object_key").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    defaultCountry: text("default_country").notNull(),
    optInSource: text("opt_in_source").notNull(),
    confirmedOptInAt: timestamp("confirmed_opt_in_at", { withTimezone: true }).notNull(),
    status: contactImportStatus("status").notNull().default("awaiting_upload"),
    totalRows: integer("total_rows").notNull().default(0),
    processedRows: integer("processed_rows").notNull().default(0),
    importedRows: integer("imported_rows").notNull().default(0),
    invalidRows: integer("invalid_rows").notNull().default(0),
    duplicateRows: integer("duplicate_rows").notNull().default(0),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("contact_imports_object_key_uq").on(table.objectKey),
    index("contact_imports_org_created_idx").on(table.organizationId, table.createdAt),
    index("contact_imports_status_idx").on(table.status),
    index("contact_imports_list_idx").on(table.listId),
  ],
);
