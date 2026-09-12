CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'scheduled', 'dispatching', 'sending', 'paused', 'completed', 'cancelled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('pending', 'connected', 'restricted', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'admin', 'member', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."recipient_status" AS ENUM('pending', 'queued', 'submitted', 'sent', 'delivered', 'read', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."template_category" AS ENUM('marketing', 'utility', 'authentication');--> statement-breakpoint
CREATE TYPE "public"."template_status" AS ENUM('draft', 'pending', 'approved', 'rejected', 'paused', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."contact_import_status" AS ENUM('awaiting_upload', 'queued', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "auth_account" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"id_token" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth_user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "auth_verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"phone_e164" text NOT NULL,
	"display_name" text,
	"status" "recipient_status" DEFAULT 'pending' NOT NULL,
	"wamid" text,
	"error_code" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"queued_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"whatsapp_phone_number_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"template_bindings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"scheduled_at" timestamp with time zone,
	"snapshot_created_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"dispatch_completed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"phone_e164" text NOT NULL,
	"display_name" text,
	"opted_in" boolean DEFAULT false NOT NULL,
	"opt_in_source" text,
	"opt_in_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credential_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credential_secrets_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "organization_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"waba_id" text NOT NULL,
	"meta_template_id" text,
	"name" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"category" "template_category" NOT NULL,
	"status" "template_status" DEFAULT 'draft' NOT NULL,
	"meta_status" text,
	"body_preview" text,
	"components" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rejection_reason" text,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_auth_id" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_external_auth_id_unique" UNIQUE("external_auth_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"phone_number_id" text,
	"event_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_phone_numbers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"meta_business_id" text,
	"waba_id" text NOT NULL,
	"phone_number_id" text NOT NULL,
	"display_phone_number" text,
	"verified_name" text,
	"status" "connection_status" DEFAULT 'pending' NOT NULL,
	"quality_rating" text,
	"throughput_mps" integer DEFAULT 80 NOT NULL,
	"credential_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_imports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"list_id" uuid,
	"original_file_name" text NOT NULL,
	"object_key" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"default_country" text NOT NULL,
	"opt_in_source" text NOT NULL,
	"confirmed_opt_in_at" timestamp with time zone NOT NULL,
	"status" "contact_import_status" DEFAULT 'awaiting_upload' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"processed_rows" integer DEFAULT 0 NOT NULL,
	"imported_rows" integer DEFAULT 0 NOT NULL,
	"invalid_rows" integer DEFAULT 0 NOT NULL,
	"duplicate_rows" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppression_list" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"phone_e164" text NOT NULL,
	"reason" text DEFAULT 'marketing_opt_out' NOT NULL,
	"source" text NOT NULL,
	"source_message_id" text,
	"suppressed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audience_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"match" text DEFAULT 'all' NOT NULL,
	"filters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_audiences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"type" text NOT NULL,
	"source_id" uuid,
	"source_name" text NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_list_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"list_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_whatsapp_phone_number_id_whatsapp_phone_numbers_id_fk" FOREIGN KEY ("whatsapp_phone_number_id") REFERENCES "public"."whatsapp_phone_numbers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_secrets" ADD CONSTRAINT "credential_secrets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_phone_numbers" ADD CONSTRAINT "whatsapp_phone_numbers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_imports" ADD CONSTRAINT "contact_imports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_imports" ADD CONSTRAINT "contact_imports_list_id_contact_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."contact_lists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppression_list" ADD CONSTRAINT "suppression_list_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_segments" ADD CONSTRAINT "audience_segments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_audiences" ADD CONSTRAINT "campaign_audiences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_audiences" ADD CONSTRAINT "campaign_audiences_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_list_members" ADD CONSTRAINT "contact_list_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_list_members" ADD CONSTRAINT "contact_list_members_list_id_contact_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."contact_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_list_members" ADD CONSTRAINT "contact_list_members_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_lists" ADD CONSTRAINT "contact_lists_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_account_user_idx" ON "auth_account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_account_provider_account_uq" ON "auth_account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "auth_session_user_idx" ON "auth_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_verification_identifier_idx" ON "auth_verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_recipients_campaign_contact_uq" ON "campaign_recipients" USING btree ("campaign_id","contact_id");--> statement-breakpoint
CREATE INDEX "campaign_recipients_dispatch_idx" ON "campaign_recipients" USING btree ("campaign_id","status","id");--> statement-breakpoint
CREATE INDEX "campaign_recipients_queue_age_idx" ON "campaign_recipients" USING btree ("status","queued_at");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_recipients_wamid_uq" ON "campaign_recipients" USING btree ("wamid");--> statement-breakpoint
CREATE INDEX "campaigns_org_status_idx" ON "campaigns" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_org_phone_uq" ON "contacts" USING btree ("organization_id","phone_e164");--> statement-breakpoint
CREATE INDEX "contacts_org_opt_in_idx" ON "contacts" USING btree ("organization_id","opted_in");--> statement-breakpoint
CREATE INDEX "credential_secrets_org_idx" ON "credential_secrets" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_members_org_user_uq" ON "organization_members" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "templates_org_waba_name_language_uq" ON "templates" USING btree ("organization_id","waba_id","name","language");--> statement-breakpoint
CREATE UNIQUE INDEX "templates_meta_id_uq" ON "templates" USING btree ("meta_template_id");--> statement-breakpoint
CREATE INDEX "templates_org_status_idx" ON "templates" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "templates_org_waba_idx" ON "templates" USING btree ("organization_id","waba_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_event_key_uq" ON "webhook_events" USING btree ("event_key");--> statement-breakpoint
CREATE INDEX "webhook_events_unprocessed_idx" ON "webhook_events" USING btree ("processed_at");--> statement-breakpoint
CREATE INDEX "webhook_events_phone_created_idx" ON "webhook_events" USING btree ("phone_number_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_events_org_created_idx" ON "webhook_events" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_phone_numbers_phone_id_uq" ON "whatsapp_phone_numbers" USING btree ("phone_number_id");--> statement-breakpoint
CREATE INDEX "whatsapp_phone_numbers_org_idx" ON "whatsapp_phone_numbers" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_imports_object_key_uq" ON "contact_imports" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "contact_imports_org_created_idx" ON "contact_imports" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "contact_imports_status_idx" ON "contact_imports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "contact_imports_list_idx" ON "contact_imports" USING btree ("list_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suppression_list_org_phone_uq" ON "suppression_list" USING btree ("organization_id","phone_e164");--> statement-breakpoint
CREATE INDEX "suppression_list_org_suppressed_idx" ON "suppression_list" USING btree ("organization_id","suppressed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "audience_segments_org_name_uq" ON "audience_segments" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "audience_segments_org_created_idx" ON "audience_segments" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_audiences_campaign_uq" ON "campaign_audiences" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "campaign_audiences_org_idx" ON "campaign_audiences" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_list_members_list_contact_uq" ON "contact_list_members" USING btree ("list_id","contact_id");--> statement-breakpoint
CREATE INDEX "contact_list_members_org_list_idx" ON "contact_list_members" USING btree ("organization_id","list_id");--> statement-breakpoint
CREATE INDEX "contact_list_members_contact_idx" ON "contact_list_members" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_lists_org_name_uq" ON "contact_lists" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "contact_lists_org_created_idx" ON "contact_lists" USING btree ("organization_id","created_at");