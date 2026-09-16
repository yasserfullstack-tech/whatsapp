import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { authUser } from "./schema";

export const legalDocumentType = pgEnum("legal_document_type", [
  "terms",
  "privacy",
  "acceptable_use",
  "anti_spam",
]);

export const legalAcceptances = pgTable(
  "legal_acceptances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authUserId: text("auth_user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    documentType: legalDocumentType("document_type").notNull(),
    documentVersion: text("document_version").notNull(),
    source: text("source").notNull().default("web"),
    userAgent: text("user_agent"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("legal_acceptances_user_document_version_uq").on(
      table.authUserId,
      table.documentType,
      table.documentVersion,
    ),
    index("legal_acceptances_user_accepted_idx").on(table.authUserId, table.acceptedAt),
  ],
);
