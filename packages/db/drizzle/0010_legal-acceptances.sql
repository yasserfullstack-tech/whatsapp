CREATE TYPE "public"."legal_document_type" AS ENUM('terms', 'privacy', 'acceptable_use', 'anti_spam');--> statement-breakpoint
CREATE TABLE "legal_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_user_id" text NOT NULL,
	"document_type" "legal_document_type" NOT NULL,
	"document_version" text NOT NULL,
	"source" text DEFAULT 'web' NOT NULL,
	"user_agent" text,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_auth_user_id_auth_user_id_fk" FOREIGN KEY ("auth_user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "legal_acceptances_user_document_version_uq" ON "legal_acceptances" USING btree ("auth_user_id","document_type","document_version");--> statement-breakpoint
CREATE INDEX "legal_acceptances_user_accepted_idx" ON "legal_acceptances" USING btree ("auth_user_id","accepted_at");
