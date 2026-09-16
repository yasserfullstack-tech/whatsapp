CREATE TABLE "contact_custom_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"field_key" text NOT NULL,
	"field_value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_custom_fields_org_contact_key_uq" UNIQUE("organization_id", "contact_id", "field_key")
);
--> statement-breakpoint
CREATE TABLE "contact_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"tag" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_tags_org_contact_tag_uq" UNIQUE("organization_id", "contact_id", "tag")
);
--> statement-breakpoint
CREATE TABLE "contact_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"contact_id" uuid,
	"event_type" text NOT NULL,
	"actor_user_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_merges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_contact_id" uuid NOT NULL,
	"target_contact_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"reason" text,
	"source_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"target_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"merged_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_merges_org_source_uq" UNIQUE("organization_id", "source_contact_id")
);
--> statement-breakpoint
CREATE TABLE "contact_import_mappings" (
	"import_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"phone_column" text NOT NULL,
	"display_name_column" text,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact_custom_fields" ADD CONSTRAINT "contact_custom_fields_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_custom_fields" ADD CONSTRAINT "contact_custom_fields_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_activity_events" ADD CONSTRAINT "contact_activity_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_activity_events" ADD CONSTRAINT "contact_activity_events_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_activity_events" ADD CONSTRAINT "contact_activity_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_merges" ADD CONSTRAINT "contact_merges_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_merges" ADD CONSTRAINT "contact_merges_source_contact_id_contacts_id_fk" FOREIGN KEY ("source_contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_merges" ADD CONSTRAINT "contact_merges_target_contact_id_contacts_id_fk" FOREIGN KEY ("target_contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_merges" ADD CONSTRAINT "contact_merges_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_import_mappings" ADD CONSTRAINT "contact_import_mappings_import_id_contact_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."contact_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_import_mappings" ADD CONSTRAINT "contact_import_mappings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_custom_fields_org_contact_idx" ON "contact_custom_fields" USING btree ("organization_id", "contact_id");--> statement-breakpoint
CREATE INDEX "contact_custom_fields_org_key_value_idx" ON "contact_custom_fields" USING btree ("organization_id", "field_key", "field_value");--> statement-breakpoint
CREATE INDEX "contact_tags_org_contact_idx" ON "contact_tags" USING btree ("organization_id", "contact_id");--> statement-breakpoint
CREATE INDEX "contact_tags_org_tag_idx" ON "contact_tags" USING btree ("organization_id", "tag");--> statement-breakpoint
CREATE INDEX "contact_notes_org_contact_created_idx" ON "contact_notes" USING btree ("organization_id", "contact_id", "created_at");--> statement-breakpoint
CREATE INDEX "contact_activity_org_contact_time_idx" ON "contact_activity_events" USING btree ("organization_id", "contact_id", "occurred_at");--> statement-breakpoint
CREATE INDEX "contact_activity_org_time_idx" ON "contact_activity_events" USING btree ("organization_id", "occurred_at");--> statement-breakpoint
CREATE INDEX "contact_merges_org_target_idx" ON "contact_merges" USING btree ("organization_id", "target_contact_id", "merged_at");--> statement-breakpoint
CREATE INDEX "contact_import_mappings_org_idx" ON "contact_import_mappings" USING btree ("organization_id", "created_at");--> statement-breakpoint
ALTER TABLE "contact_custom_fields" ADD CONSTRAINT "contact_custom_fields_key_length_ck" CHECK (char_length("field_key") BETWEEN 1 AND 40);--> statement-breakpoint
ALTER TABLE "contact_custom_fields" ADD CONSTRAINT "contact_custom_fields_value_length_ck" CHECK (char_length("field_value") <= 500);--> statement-breakpoint
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_tag_length_ck" CHECK (char_length("tag") BETWEEN 1 AND 40);--> statement-breakpoint
ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_body_length_ck" CHECK (char_length("body") BETWEEN 1 AND 4000);