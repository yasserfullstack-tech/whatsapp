import {
  boolean,
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
import { organizations, users } from "./schema";

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const billingSubscriptionStatus = pgEnum("billing_subscription_status", [
  "trialing",
  "active",
  "past_due",
  "grace_period",
  "suspended",
  "cancelled",
]);

export const billingInterval = pgEnum("billing_interval", ["month", "year", "custom"]);
export const billingInvoiceStatus = pgEnum("billing_invoice_status", [
  "draft",
  "open",
  "paid",
  "void",
  "uncollectible",
]);
export const billingPaymentStatus = pgEnum("billing_payment_status", [
  "pending",
  "succeeded",
  "failed",
  "refunded",
  "partially_refunded",
]);

export const billingAccounts = pgTable(
  "billing_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    providerKey: text("provider_key"),
    providerCustomerId: text("provider_customer_id"),
    billingEmail: text("billing_email"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("billing_accounts_org_uq").on(table.organizationId),
    uniqueIndex("billing_accounts_provider_customer_uq").on(table.providerKey, table.providerCustomerId),
  ],
);

export const billingPlans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    isCustom: boolean("is_custom").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("plans_code_uq").on(table.code),
    index("plans_org_active_idx").on(table.organizationId, table.isActive),
  ],
);

export const billingPlanVersions = pgTable(
  "plan_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => billingPlans.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    interval: billingInterval("interval").notNull().default("month"),
    currency: text("currency").notNull().default("USD"),
    priceMinor: integer("price_minor"),
    providerPriceRef: text("provider_price_ref"),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    createdAt,
  },
  (table) => [
    uniqueIndex("plan_versions_plan_version_uq").on(table.planId, table.version),
    index("plan_versions_effective_idx").on(table.planId, table.effectiveFrom, table.effectiveTo),
  ],
);

export const billingPlanEntitlements = pgTable(
  "plan_entitlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planVersionId: uuid("plan_version_id")
      .notNull()
      .references(() => billingPlanVersions.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    limitValue: integer("limit_value"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("plan_entitlements_version_key_uq").on(table.planVersionId, table.key),
    index("plan_entitlements_key_idx").on(table.key),
  ],
);

export const billingSubscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    billingAccountId: uuid("billing_account_id")
      .notNull()
      .references(() => billingAccounts.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    planVersionId: uuid("plan_version_id")
      .notNull()
      .references(() => billingPlanVersions.id),
    providerKey: text("provider_key"),
    providerSubscriptionId: text("provider_subscription_id"),
    status: billingSubscriptionStatus("status").notNull().default("active"),
    isManual: boolean("is_manual").notNull().default(false),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }).notNull(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }).notNull(),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    graceEndsAt: timestamp("grace_ends_at", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("subscriptions_org_status_idx").on(table.organizationId, table.status),
    index("subscriptions_account_status_idx").on(table.billingAccountId, table.status),
    uniqueIndex("subscriptions_provider_subscription_uq").on(table.providerKey, table.providerSubscriptionId),
  ],
);

export const billingSubscriptionChanges = pgTable(
  "subscription_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => billingSubscriptions.id, { onDelete: "cascade" }),
    fromPlanVersionId: uuid("from_plan_version_id").references(() => billingPlanVersions.id),
    toPlanVersionId: uuid("to_plan_version_id").references(() => billingPlanVersions.id),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    kind: text("kind").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt,
  },
  (table) => [
    index("subscription_changes_org_created_idx").on(table.organizationId, table.createdAt),
    index("subscription_changes_subscription_idx").on(table.subscriptionId, table.createdAt),
  ],
);

export const billingUsageLedger = pgTable(
  "usage_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => billingSubscriptions.id, { onDelete: "cascade" }),
    entitlementKey: text("entitlement_key").notNull(),
    quantity: integer("quantity").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt,
  },
  (table) => [
    uniqueIndex("usage_ledger_org_idempotency_uq").on(table.organizationId, table.idempotencyKey),
    index("usage_ledger_org_key_period_idx").on(
      table.organizationId,
      table.entitlementKey,
      table.periodStart,
      table.periodEnd,
    ),
  ],
);

export const billingPeriodUsage = pgTable(
  "billing_period_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => billingSubscriptions.id, { onDelete: "cascade" }),
    entitlementKey: text("entitlement_key").notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    quantity: integer("quantity").notNull().default(0),
    updatedAt,
  },
  (table) => [
    uniqueIndex("billing_period_usage_scope_uq").on(
      table.organizationId,
      table.subscriptionId,
      table.entitlementKey,
      table.periodStart,
      table.periodEnd,
    ),
    index("billing_period_usage_org_period_idx").on(table.organizationId, table.periodStart, table.periodEnd),
  ],
);

export const billingInvoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    billingAccountId: uuid("billing_account_id")
      .notNull()
      .references(() => billingAccounts.id, { onDelete: "cascade" }),
    subscriptionId: uuid("subscription_id").references(() => billingSubscriptions.id, { onDelete: "set null" }),
    providerKey: text("provider_key"),
    providerInvoiceId: text("provider_invoice_id"),
    invoiceNumber: text("invoice_number"),
    status: billingInvoiceStatus("status").notNull().default("draft"),
    currency: text("currency").notNull().default("USD"),
    subtotalMinor: integer("subtotal_minor").notNull().default(0),
    taxMinor: integer("tax_minor").notNull().default(0),
    totalMinor: integer("total_minor").notNull().default(0),
    amountDueMinor: integer("amount_due_minor").notNull().default(0),
    amountPaidMinor: integer("amount_paid_minor").notNull().default(0),
    periodStart: timestamp("period_start", { withTimezone: true }),
    periodEnd: timestamp("period_end", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("invoices_org_created_idx").on(table.organizationId, table.createdAt),
    uniqueIndex("invoices_provider_invoice_uq").on(table.providerKey, table.providerInvoiceId),
  ],
);

export const billingPayments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id").references(() => billingInvoices.id, { onDelete: "set null" }),
    providerKey: text("provider_key"),
    providerPaymentId: text("provider_payment_id"),
    status: billingPaymentStatus("status").notNull().default("pending"),
    currency: text("currency").notNull().default("USD"),
    amountMinor: integer("amount_minor").notNull(),
    refundedAmountMinor: integer("refunded_amount_minor").notNull().default(0),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt,
  },
  (table) => [
    index("payments_org_created_idx").on(table.organizationId, table.createdAt),
    uniqueIndex("payments_provider_payment_uq").on(table.providerKey, table.providerPaymentId),
  ],
);

export const billingProviderEvents = pgTable(
  "billing_provider_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerKey: text("provider_key").notNull(),
    externalEventId: text("external_event_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt,
  },
  (table) => [
    uniqueIndex("billing_provider_events_provider_event_uq").on(table.providerKey, table.externalEventId),
    index("billing_provider_events_processed_idx").on(table.processedAt, table.createdAt),
  ],
);
