import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { authUser, organizations, users } from "./schema";

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const organizationAdminStatus = pgEnum("organization_admin_status", ["active", "suspended"]);

/**
 * Platform administration is intentionally separate from organization membership roles.
 * A workspace owner/admin/member/viewer never gains platform access through membership.
 */
export const platformAdminGrants = pgTable(
  "platform_admin_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authUserId: text("auth_user_id").notNull().references(() => authUser.id, { onDelete: "cascade" }),
    source: text("source").notNull().default("manual"),
    createdByAuthUserId: text("created_by_auth_user_id").references(() => authUser.id, { onDelete: "set null" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [uniqueIndex("platform_admin_grants_auth_user_uq").on(table.authUserId)],
);

export const organizationAdminSettings = pgTable(
  "organization_admin_settings",
  {
    organizationId: uuid("organization_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
    status: organizationAdminStatus("status").notNull().default("active"),
    plan: text("plan").notNull().default("standard"),
    contactLimit: integer("contact_limit"),
    campaignRecipientLimit: integer("campaign_recipient_limit"),
    monthlyMessageLimit: integer("monthly_message_limit"),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    suspendedReason: text("suspended_reason"),
    updatedAt,
  },
  (table) => [index("organization_admin_settings_status_idx").on(table.status)],
);

export const platformUserControls = pgTable(
  "platform_user_controls",
  {
    userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
    disabled: boolean("disabled").notNull().default(false),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    disabledReason: text("disabled_reason"),
    updatedAt,
  },
  (table) => [index("platform_user_controls_disabled_idx").on(table.disabled)],
);

export const platformAuditEvents = pgTable(
  "platform_audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorAuthUserId: text("actor_auth_user_id").references(() => authUser.id, { onDelete: "set null" }),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt,
  },
  (table) => [
    index("platform_audit_events_actor_created_idx").on(table.actorAuthUserId, table.createdAt),
    index("platform_audit_events_org_created_idx").on(table.organizationId, table.createdAt),
    index("platform_audit_events_target_idx").on(table.targetType, table.targetId),
    index("platform_audit_events_created_idx").on(table.createdAt),
  ],
);
