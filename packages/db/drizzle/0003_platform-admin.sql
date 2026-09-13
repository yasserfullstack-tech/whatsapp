CREATE TYPE "public"."organization_admin_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TABLE "organization_admin_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"status" "organization_admin_status" DEFAULT 'active' NOT NULL,
	"plan" text DEFAULT 'standard' NOT NULL,
	"contact_limit" integer,
	"campaign_recipient_limit" integer,
	"monthly_message_limit" integer,
	"suspended_at" timestamp with time zone,
	"suspended_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_admin_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_user_id" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_by_auth_user_id" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_auth_user_id" text,
	"organization_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_user_controls" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"disabled" boolean DEFAULT false NOT NULL,
	"disabled_at" timestamp with time zone,
	"disabled_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_admin_settings" ADD CONSTRAINT "organization_admin_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_admin_grants" ADD CONSTRAINT "platform_admin_grants_auth_user_id_auth_user_id_fk" FOREIGN KEY ("auth_user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_admin_grants" ADD CONSTRAINT "platform_admin_grants_created_by_auth_user_id_auth_user_id_fk" FOREIGN KEY ("created_by_auth_user_id") REFERENCES "public"."auth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_audit_events" ADD CONSTRAINT "platform_audit_events_actor_auth_user_id_auth_user_id_fk" FOREIGN KEY ("actor_auth_user_id") REFERENCES "public"."auth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_audit_events" ADD CONSTRAINT "platform_audit_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_user_controls" ADD CONSTRAINT "platform_user_controls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_admin_settings_status_idx" ON "organization_admin_settings" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_admin_grants_auth_user_uq" ON "platform_admin_grants" USING btree ("auth_user_id");--> statement-breakpoint
CREATE INDEX "platform_audit_events_actor_created_idx" ON "platform_audit_events" USING btree ("actor_auth_user_id","created_at");--> statement-breakpoint
CREATE INDEX "platform_audit_events_org_created_idx" ON "platform_audit_events" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "platform_audit_events_target_idx" ON "platform_audit_events" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "platform_audit_events_created_idx" ON "platform_audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "platform_user_controls_disabled_idx" ON "platform_user_controls" USING btree ("disabled");