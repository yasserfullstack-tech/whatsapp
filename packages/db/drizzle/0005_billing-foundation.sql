CREATE TYPE "public"."billing_interval" AS ENUM('month', 'year', 'custom');--> statement-breakpoint
CREATE TYPE "public"."billing_invoice_status" AS ENUM('draft', 'open', 'paid', 'void', 'uncollectible');--> statement-breakpoint
CREATE TYPE "public"."billing_payment_status" AS ENUM('pending', 'succeeded', 'failed', 'refunded', 'partially_refunded');--> statement-breakpoint
CREATE TYPE "public"."billing_subscription_status" AS ENUM('trialing', 'active', 'past_due', 'grace_period', 'suspended', 'cancelled');--> statement-breakpoint
CREATE TABLE "billing_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider_key" text,
	"provider_customer_id" text,
	"billing_email" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"billing_account_id" uuid NOT NULL,
	"subscription_id" uuid,
	"provider_key" text,
	"provider_invoice_id" text,
	"invoice_number" text,
	"status" "billing_invoice_status" DEFAULT 'draft' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"subtotal_minor" integer DEFAULT 0 NOT NULL,
	"tax_minor" integer DEFAULT 0 NOT NULL,
	"total_minor" integer DEFAULT 0 NOT NULL,
	"amount_due_minor" integer DEFAULT 0 NOT NULL,
	"amount_paid_minor" integer DEFAULT 0 NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"due_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid,
	"provider_key" text,
	"provider_payment_id" text,
	"status" "billing_payment_status" DEFAULT 'pending' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"amount_minor" integer NOT NULL,
	"refunded_amount_minor" integer DEFAULT 0 NOT NULL,
	"paid_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_period_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"entitlement_key" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_version_id" uuid NOT NULL,
	"key" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"limit_value" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"interval" "billing_interval" DEFAULT 'month' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"price_minor" integer,
	"provider_price_ref" text,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_custom" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_provider_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_key" text NOT NULL,
	"external_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"verified_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"from_plan_version_id" uuid,
	"to_plan_version_id" uuid,
	"from_status" text,
	"to_status" text,
	"kind" text NOT NULL,
	"actor_user_id" uuid,
	"effective_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"billing_account_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"plan_version_id" uuid NOT NULL,
	"provider_key" text,
	"provider_subscription_id" text,
	"status" "billing_subscription_status" DEFAULT 'active' NOT NULL,
	"is_manual" boolean DEFAULT false NOT NULL,
	"current_period_start" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"grace_ends_at" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"entitlement_key" text NOT NULL,
	"quantity" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_billing_account_id_billing_accounts_id_fk" FOREIGN KEY ("billing_account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_period_usage" ADD CONSTRAINT "billing_period_usage_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_period_usage" ADD CONSTRAINT "billing_period_usage_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_entitlements" ADD CONSTRAINT "plan_entitlements_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_changes" ADD CONSTRAINT "subscription_changes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_changes" ADD CONSTRAINT "subscription_changes_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_changes" ADD CONSTRAINT "subscription_changes_from_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("from_plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_changes" ADD CONSTRAINT "subscription_changes_to_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("to_plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_changes" ADD CONSTRAINT "subscription_changes_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_billing_account_id_billing_accounts_id_fk" FOREIGN KEY ("billing_account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_accounts_org_uq" ON "billing_accounts" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_accounts_provider_customer_uq" ON "billing_accounts" USING btree ("provider_key","provider_customer_id");--> statement-breakpoint
CREATE INDEX "invoices_org_created_idx" ON "invoices" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_provider_invoice_uq" ON "invoices" USING btree ("provider_key","provider_invoice_id");--> statement-breakpoint
CREATE INDEX "payments_org_created_idx" ON "payments" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_payment_uq" ON "payments" USING btree ("provider_key","provider_payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_period_usage_scope_uq" ON "billing_period_usage" USING btree ("organization_id","subscription_id","entitlement_key","period_start","period_end");--> statement-breakpoint
CREATE INDEX "billing_period_usage_org_period_idx" ON "billing_period_usage" USING btree ("organization_id","period_start","period_end");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_entitlements_version_key_uq" ON "plan_entitlements" USING btree ("plan_version_id","key");--> statement-breakpoint
CREATE INDEX "plan_entitlements_key_idx" ON "plan_entitlements" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_versions_plan_version_uq" ON "plan_versions" USING btree ("plan_id","version");--> statement-breakpoint
CREATE INDEX "plan_versions_effective_idx" ON "plan_versions" USING btree ("plan_id","effective_from","effective_to");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_code_uq" ON "plans" USING btree ("code");--> statement-breakpoint
CREATE INDEX "plans_org_active_idx" ON "plans" USING btree ("organization_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_provider_events_provider_event_uq" ON "billing_provider_events" USING btree ("provider_key","external_event_id");--> statement-breakpoint
CREATE INDEX "billing_provider_events_processed_idx" ON "billing_provider_events" USING btree ("processed_at","created_at");--> statement-breakpoint
CREATE INDEX "subscription_changes_org_created_idx" ON "subscription_changes" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "subscription_changes_subscription_idx" ON "subscription_changes" USING btree ("subscription_id","created_at");--> statement-breakpoint
CREATE INDEX "subscriptions_org_status_idx" ON "subscriptions" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "subscriptions_account_status_idx" ON "subscriptions" USING btree ("billing_account_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_provider_subscription_uq" ON "subscriptions" USING btree ("provider_key","provider_subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_ledger_org_idempotency_uq" ON "usage_ledger" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "usage_ledger_org_key_period_idx" ON "usage_ledger" USING btree ("organization_id","entitlement_key","period_start","period_end");--> statement-breakpoint

INSERT INTO "plans" ("id", "code", "name", "description", "is_custom", "is_active") VALUES
  ('00000000-0000-4000-8000-000000000101', 'starter', 'Starter', 'Starter SaaS subscription', false, true),
  ('00000000-0000-4000-8000-000000000102', 'growth', 'Growth', 'Growth SaaS subscription', false, true),
  ('00000000-0000-4000-8000-000000000103', 'scale', 'Scale', 'Scale SaaS subscription', false, true),
  ('00000000-0000-4000-8000-000000000104', 'custom', 'Custom', 'Custom enterprise SaaS subscription template', true, true)
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint

INSERT INTO "plan_versions" ("id", "plan_id", "version", "interval", "currency", "price_minor") VALUES
  ('00000000-0000-4000-8000-000000001101', '00000000-0000-4000-8000-000000000101', 1, 'month', 'USD', NULL),
  ('00000000-0000-4000-8000-000000001102', '00000000-0000-4000-8000-000000000102', 1, 'month', 'USD', NULL),
  ('00000000-0000-4000-8000-000000001103', '00000000-0000-4000-8000-000000000103', 1, 'month', 'USD', NULL),
  ('00000000-0000-4000-8000-000000001104', '00000000-0000-4000-8000-000000000104', 1, 'custom', 'USD', NULL)
ON CONFLICT ("plan_id", "version") DO NOTHING;--> statement-breakpoint

INSERT INTO "plan_entitlements" ("plan_version_id", "key", "limit_value")
SELECT pv."id", seed."key", seed."limit_value"
FROM (VALUES
  ('starter'::text, 'max_contacts'::text, 10000::integer),
  ('starter', 'max_members', 3),
  ('starter', 'max_phone_numbers', 1),
  ('starter', 'monthly_campaign_recipients', 10000),
  ('starter', 'max_import_size', 10000),
  ('starter', 'analytics_retention_days', 30),
  ('starter', 'audit_retention_days', 30),
  ('growth', 'max_contacts', 100000),
  ('growth', 'max_members', 10),
  ('growth', 'max_phone_numbers', 3),
  ('growth', 'monthly_campaign_recipients', 100000),
  ('growth', 'max_import_size', 100000),
  ('growth', 'analytics_retention_days', 90),
  ('growth', 'audit_retention_days', 180),
  ('scale', 'max_contacts', 500000),
  ('scale', 'max_members', 25),
  ('scale', 'max_phone_numbers', 10),
  ('scale', 'monthly_campaign_recipients', 500000),
  ('scale', 'max_import_size', 500000),
  ('scale', 'analytics_retention_days', 365),
  ('scale', 'audit_retention_days', 730),
  ('custom', 'max_contacts', NULL::integer),
  ('custom', 'max_members', NULL::integer),
  ('custom', 'max_phone_numbers', NULL::integer),
  ('custom', 'monthly_campaign_recipients', NULL::integer),
  ('custom', 'max_import_size', NULL::integer),
  ('custom', 'analytics_retention_days', NULL::integer),
  ('custom', 'audit_retention_days', NULL::integer)
) AS seed("plan_code", "key", "limit_value")
JOIN "plans" p ON p."code" = seed."plan_code"
JOIN "plan_versions" pv ON pv."plan_id" = p."id" AND pv."version" = 1
ON CONFLICT ("plan_version_id", "key") DO NOTHING;--> statement-breakpoint

INSERT INTO "billing_accounts" ("organization_id")
SELECT o."id" FROM "organizations" o
ON CONFLICT ("organization_id") DO NOTHING;--> statement-breakpoint

INSERT INTO "subscriptions" (
  "billing_account_id",
  "organization_id",
  "plan_version_id",
  "status",
  "current_period_start",
  "current_period_end"
)
SELECT
  ba."id",
  ba."organization_id",
  pv."id",
  'active',
  now(),
  now() + interval '1 month'
FROM "billing_accounts" ba
JOIN "plans" p ON p."code" = 'starter'
JOIN "plan_versions" pv ON pv."plan_id" = p."id" AND pv."version" = 1
WHERE NOT EXISTS (
  SELECT 1 FROM "subscriptions" s WHERE s."organization_id" = ba."organization_id"
);--> statement-breakpoint

INSERT INTO "subscription_changes" (
  "organization_id",
  "subscription_id",
  "to_plan_version_id",
  "to_status",
  "kind",
  "metadata"
)
SELECT s."organization_id", s."id", s."plan_version_id", s."status"::text, 'activation', '{"source":"billing_foundation_migration"}'::jsonb
FROM "subscriptions" s
WHERE NOT EXISTS (
  SELECT 1 FROM "subscription_changes" sc WHERE sc."subscription_id" = s."id"
);--> statement-breakpoint

INSERT INTO "workspace_audit_logs" (
  "organization_id",
  "action",
  "target_type",
  "target_id",
  "metadata"
)
SELECT s."organization_id", 'billing.subscription_activated', 'subscription', s."id"::text, '{"source":"billing_foundation_migration"}'::jsonb
FROM "subscriptions" s
WHERE NOT EXISTS (
  SELECT 1 FROM "workspace_audit_logs" wal
  WHERE wal."organization_id" = s."organization_id"
    AND wal."action" = 'billing.subscription_activated'
    AND wal."target_type" = 'subscription'
    AND wal."target_id" = s."id"::text
);
