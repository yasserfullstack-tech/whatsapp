CREATE TYPE "public"."inbox_conversation_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."inbox_message_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."inbox_message_source" AS ENUM('inbound', 'agent_reply', 'campaign');--> statement-breakpoint
CREATE TYPE "public"."inbox_message_type" AS ENUM('text', 'button', 'interactive', 'image', 'video', 'audio', 'document', 'sticker', 'other');--> statement-breakpoint
CREATE TYPE "public"."inbox_message_status" AS ENUM('received', 'pending', 'submitted', 'sent', 'delivered', 'read', 'failed');--> statement-breakpoint
CREATE TABLE "inbox_conversations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "whatsapp_phone_number_id" uuid NOT NULL,
  "contact_id" uuid,
  "customer_phone_e164" text NOT NULL,
  "customer_display_name" text,
  "assigned_user_id" uuid,
  "status" "inbox_conversation_status" DEFAULT 'open' NOT NULL,
  "unread_count" integer DEFAULT 0 NOT NULL,
  "last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_inbound_at" timestamp with time zone,
  "last_outbound_at" timestamp with time zone,
  "closed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "inbox_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "conversation_id" uuid NOT NULL,
  "whatsapp_phone_number_id" uuid NOT NULL,
  "contact_id" uuid,
  "agent_user_id" uuid,
  "direction" "inbox_message_direction" NOT NULL,
  "source" "inbox_message_source" NOT NULL,
  "message_type" "inbox_message_type" DEFAULT 'other' NOT NULL,
  "status" "inbox_message_status" NOT NULL,
  "wamid" text,
  "sender_phone" text,
  "recipient_phone" text,
  "sender_display_name" text,
  "recipient_display_name" text,
  "text" text,
  "media_id" text,
  "media_mime_type" text,
  "media_sha256" text,
  "media_file_name" text,
  "media_caption" text,
  "interactive_payload" jsonb,
  "error_code" text,
  "error_message" text,
  "provider_timestamp" timestamp with time zone,
  "submitted_at" timestamp with time zone,
  "sent_at" timestamp with time zone,
  "delivered_at" timestamp with time zone,
  "read_at" timestamp with time zone,
  "failed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "inbox_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "conversation_id" uuid NOT NULL,
  "author_user_id" uuid NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "inbox_webhook_receipts" (
  "webhook_event_id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid,
  "processed_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "inbox_conversations" ADD CONSTRAINT "inbox_conversations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_conversations" ADD CONSTRAINT "inbox_conversations_whatsapp_phone_number_id_whatsapp_phone_numbers_id_fk" FOREIGN KEY ("whatsapp_phone_number_id") REFERENCES "public"."whatsapp_phone_numbers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_conversations" ADD CONSTRAINT "inbox_conversations_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_conversations" ADD CONSTRAINT "inbox_conversations_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD CONSTRAINT "inbox_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD CONSTRAINT "inbox_messages_conversation_id_inbox_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."inbox_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD CONSTRAINT "inbox_messages_whatsapp_phone_number_id_whatsapp_phone_numbers_id_fk" FOREIGN KEY ("whatsapp_phone_number_id") REFERENCES "public"."whatsapp_phone_numbers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD CONSTRAINT "inbox_messages_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD CONSTRAINT "inbox_messages_agent_user_id_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_notes" ADD CONSTRAINT "inbox_notes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_notes" ADD CONSTRAINT "inbox_notes_conversation_id_inbox_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."inbox_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_notes" ADD CONSTRAINT "inbox_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_webhook_receipts" ADD CONSTRAINT "inbox_webhook_receipts_webhook_event_id_webhook_events_id_fk" FOREIGN KEY ("webhook_event_id") REFERENCES "public"."webhook_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_webhook_receipts" ADD CONSTRAINT "inbox_webhook_receipts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_conversations_scope_uq" ON "inbox_conversations" USING btree ("organization_id","whatsapp_phone_number_id","customer_phone_e164");--> statement-breakpoint
CREATE INDEX "inbox_conversations_org_activity_idx" ON "inbox_conversations" USING btree ("organization_id","status","last_message_at");--> statement-breakpoint
CREATE INDEX "inbox_conversations_assignment_idx" ON "inbox_conversations" USING btree ("organization_id","assigned_user_id","status");--> statement-breakpoint
CREATE INDEX "inbox_conversations_unread_idx" ON "inbox_conversations" USING btree ("organization_id","unread_count","last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_messages_org_wamid_uq" ON "inbox_messages" USING btree ("organization_id","wamid");--> statement-breakpoint
CREATE INDEX "inbox_messages_conversation_time_idx" ON "inbox_messages" USING btree ("conversation_id","provider_timestamp","created_at");--> statement-breakpoint
CREATE INDEX "inbox_messages_org_status_idx" ON "inbox_messages" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX "inbox_messages_phone_idx" ON "inbox_messages" USING btree ("organization_id","whatsapp_phone_number_id","created_at");--> statement-breakpoint
CREATE INDEX "inbox_notes_conversation_idx" ON "inbox_notes" USING btree ("organization_id","conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "inbox_webhook_receipts_org_idx" ON "inbox_webhook_receipts" USING btree ("organization_id","processed_at");