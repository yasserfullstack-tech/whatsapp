CREATE TYPE "public"."connection_health_status" AS ENUM('unknown', 'healthy', 'degraded', 'reauthorization_required');--> statement-breakpoint
ALTER TABLE "whatsapp_phone_numbers" ADD COLUMN "health_status" "connection_health_status" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_phone_numbers" ADD COLUMN "last_validated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "whatsapp_phone_numbers" ADD COLUMN "reauthorization_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_phone_numbers" ADD COLUMN "failure_code" text;--> statement-breakpoint
ALTER TABLE "whatsapp_phone_numbers" ADD COLUMN "failure_reason" text;--> statement-breakpoint
ALTER TABLE "whatsapp_phone_numbers" ADD COLUMN "credential_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "whatsapp_phone_numbers_health_idx" ON "whatsapp_phone_numbers" USING btree ("status","reauthorization_required","last_validated_at");