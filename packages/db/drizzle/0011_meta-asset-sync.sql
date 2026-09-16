CREATE TABLE "meta_asset_webhook_receipts" (
  "event_id" uuid PRIMARY KEY NOT NULL,
  "processing_status" text DEFAULT 'pending' NOT NULL,
  "processing_attempts" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "next_retry_at" timestamp with time zone,
  "processed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meta_asset_webhook_receipts" ADD CONSTRAINT "meta_asset_webhook_receipts_event_id_webhook_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."webhook_events"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "meta_asset_webhook_receipts_retry_idx" ON "meta_asset_webhook_receipts" USING btree ("processing_status","next_retry_at");
--> statement-breakpoint
CREATE TABLE "meta_asset_state_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "resource_type" text NOT NULL,
  "resource_key" text NOT NULL,
  "provider_event_at" timestamp with time zone NOT NULL,
  "fingerprint" text NOT NULL,
  "source" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "meta_asset_state_versions_resource_uq" ON "meta_asset_state_versions" USING btree ("resource_type","resource_key");
--> statement-breakpoint
CREATE INDEX "meta_asset_state_versions_provider_event_idx" ON "meta_asset_state_versions" USING btree ("provider_event_at");
