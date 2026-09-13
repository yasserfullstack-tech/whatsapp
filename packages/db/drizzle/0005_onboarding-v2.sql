CREATE TABLE "organization_onboarding" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"consent_confirmed_at" timestamp with time zone,
	"skipped_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"test_campaign_id" uuid,
	"skipped_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_onboarding" ADD CONSTRAINT "organization_onboarding_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_onboarding" ADD CONSTRAINT "organization_onboarding_test_campaign_id_campaigns_id_fk" FOREIGN KEY ("test_campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;