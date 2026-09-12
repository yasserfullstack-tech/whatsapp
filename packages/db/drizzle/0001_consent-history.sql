CREATE TABLE "contact_consent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"contact_id" uuid,
	"phone_e164" text NOT NULL,
	"event_type" text NOT NULL,
	"source" text NOT NULL,
	"source_message_id" text,
	"note" text,
	"actor_user_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact_consent_events" ADD CONSTRAINT "contact_consent_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_consent_events" ADD CONSTRAINT "contact_consent_events_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_consent_events" ADD CONSTRAINT "contact_consent_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_consent_events_org_phone_time_idx" ON "contact_consent_events" USING btree ("organization_id","phone_e164","occurred_at");--> statement-breakpoint
CREATE INDEX "contact_consent_events_org_type_time_idx" ON "contact_consent_events" USING btree ("organization_id","event_type","occurred_at");
