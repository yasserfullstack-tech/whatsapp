CREATE TYPE "public"."data_export_kind" AS ENUM('contacts', 'campaign_recipients', 'consent_history', 'campaigns', 'workspace');
--> statement-breakpoint
CREATE TYPE "public"."data_export_status" AS ENUM('queued', 'processing', 'completed', 'failed', 'expired');
--> statement-breakpoint
CREATE TYPE "public"."workspace_deletion_status" AS ENUM('cooling_off', 'disabled', 'purging', 'completed', 'cancelled', 'failed');
--> statement-breakpoint
ALTER TABLE "contact_imports" ADD COLUMN "object_deleted_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE "data_export_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "requested_by_user_id" uuid,
  "kind" "data_export_kind" NOT NULL,
  "status" "data_export_status" DEFAULT 'queued' NOT NULL,
  "object_key" text NOT NULL,
  "file_name" text NOT NULL,
  "content_type" text DEFAULT 'application/x-ndjson' NOT NULL,
  "row_count" integer DEFAULT 0 NOT NULL,
  "expires_at" timestamp with time zone,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "failed_at" timestamp with time zone,
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_retention_policies" (
  "organization_id" uuid PRIMARY KEY NOT NULL,
  "raw_webhook_days" integer DEFAULT 30 NOT NULL,
  "import_file_days" integer DEFAULT 7 NOT NULL,
  "export_file_hours" integer DEFAULT 24 NOT NULL,
  "audit_log_days" integer DEFAULT 365 NOT NULL,
  "campaign_recipient_days" integer DEFAULT 365 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_deletion_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "requested_by_user_id" uuid,
  "status" "workspace_deletion_status" DEFAULT 'cooling_off' NOT NULL,
  "cooling_off_ends_at" timestamp with time zone NOT NULL,
  "purge_after" timestamp with time zone NOT NULL,
  "disabled_at" timestamp with time zone,
  "purge_started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "failed_at" timestamp with time zone,
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_lifecycle_audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid,
  "actor_user_id" uuid,
  "actor_auth_user_id" text,
  "action" text NOT NULL,
  "target_type" text NOT NULL,
  "target_id" text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "data_export_jobs" ADD CONSTRAINT "data_export_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "data_export_jobs" ADD CONSTRAINT "data_export_jobs_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "data_retention_policies" ADD CONSTRAINT "data_retention_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_deletion_requests" ADD CONSTRAINT "workspace_deletion_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "data_export_jobs_object_key_uq" ON "data_export_jobs" USING btree ("object_key");
CREATE INDEX "data_export_jobs_org_created_idx" ON "data_export_jobs" USING btree ("organization_id", "created_at");
CREATE INDEX "data_export_jobs_status_expiry_idx" ON "data_export_jobs" USING btree ("status", "expires_at");
CREATE UNIQUE INDEX "workspace_deletion_requests_org_uq" ON "workspace_deletion_requests" USING btree ("organization_id");
CREATE INDEX "workspace_deletion_requests_status_due_idx" ON "workspace_deletion_requests" USING btree ("status", "cooling_off_ends_at", "purge_after");
CREATE INDEX "data_lifecycle_audit_org_created_idx" ON "data_lifecycle_audit_logs" USING btree ("organization_id", "created_at");
CREATE INDEX "data_lifecycle_audit_actor_created_idx" ON "data_lifecycle_audit_logs" USING btree ("actor_auth_user_id", "created_at");
CREATE INDEX "data_lifecycle_audit_action_created_idx" ON "data_lifecycle_audit_logs" USING btree ("action", "created_at");
