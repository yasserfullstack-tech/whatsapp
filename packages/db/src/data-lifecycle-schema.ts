import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations, users } from "./schema";

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const dataExportKind = pgEnum("data_export_kind", [
  "contacts",
  "campaign_recipients",
  "consent_history",
  "campaigns",
  "workspace",
]);

export const dataExportStatus = pgEnum("data_export_status", [
  "queued",
  "processing",
  "completed",
  "failed",
  "expired",
]);

export const workspaceDeletionStatus = pgEnum("workspace_deletion_status", [
  "cooling_off",
  "disabled",
  "purging",
  "completed",
  "cancelled",
  "failed",
]);

export const dataExportJobs = pgTable(
  "data_export_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    requestedByUserId: uuid("requested_by_user_id").references(() => users.id, { onDelete: "set null" }),
    kind: dataExportKind("kind").notNull(),
    status: dataExportStatus("status").notNull().default("queued"),
    objectKey: text("object_key").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull().default("application/x-ndjson"),
    rowCount: integer("row_count").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("data_export_jobs_object_key_uq").on(table.objectKey),
    index("data_export_jobs_org_created_idx").on(table.organizationId, table.createdAt),
    index("data_export_jobs_status_expiry_idx").on(table.status, table.expiresAt),
  ],
);

export const dataRetentionPolicies = pgTable("data_retention_policies", {
  organizationId: uuid("organization_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  rawWebhookDays: integer("raw_webhook_days").notNull().default(30),
  importFileDays: integer("import_file_days").notNull().default(7),
  exportFileHours: integer("export_file_hours").notNull().default(24),
  auditLogDays: integer("audit_log_days").notNull().default(365),
  campaignRecipientDays: integer("campaign_recipient_days").notNull().default(365),
  updatedAt,
});

/**
 * Intentionally does not reference organizations. The row is retained after the
 * organization is purged so support can prove the requested deletion lifecycle.
 */
export const workspaceDeletionRequests = pgTable(
  "workspace_deletion_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    requestedByUserId: uuid("requested_by_user_id").references(() => users.id, { onDelete: "set null" }),
    status: workspaceDeletionStatus("status").notNull().default("cooling_off"),
    coolingOffEndsAt: timestamp("cooling_off_ends_at", { withTimezone: true }).notNull(),
    purgeAfter: timestamp("purge_after", { withTimezone: true }).notNull(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    purgeStartedAt: timestamp("purge_started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("workspace_deletion_requests_org_uq").on(table.organizationId),
    index("workspace_deletion_requests_status_due_idx").on(table.status, table.coolingOffEndsAt, table.purgeAfter),
  ],
);

/** Minimal, long-lived evidence for export and deletion operations. */
export const dataLifecycleAuditLogs = pgTable(
  "data_lifecycle_audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id"),
    actorUserId: uuid("actor_user_id"),
    actorAuthUserId: text("actor_auth_user_id"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt,
  },
  (table) => [
    index("data_lifecycle_audit_org_created_idx").on(table.organizationId, table.createdAt),
    index("data_lifecycle_audit_actor_created_idx").on(table.actorAuthUserId, table.createdAt),
    index("data_lifecycle_audit_action_created_idx").on(table.action, table.createdAt),
  ],
);
