import { sql } from "drizzle-orm";
import { createDatabase } from "@wa/db";
import type { WhatsAppInboundMessage, WhatsAppMessageStatus } from "@wa/meta/webhooks";

type Database = ReturnType<typeof createDatabase>["db"];

export function eventTime(status: WhatsAppMessageStatus | WhatsAppInboundMessage): Date {
  if (status.timestampSeconds !== undefined) {
    const date = new Date(status.timestampSeconds * 1_000);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return new Date();
}

export type WebhookRecipientStatus =
  | "pending"
  | "queued"
  | "submitted"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "skipped";

export function webhookRecipientStatusAfter(
  current: WebhookRecipientStatus,
  incoming: WhatsAppMessageStatus["status"],
): WebhookRecipientStatus {
  if (incoming === "sent") {
    return ["pending", "queued", "submitted", "sent"].includes(current) ? "sent" : current;
  }
  if (incoming === "delivered") {
    return ["pending", "queued", "submitted", "sent", "delivered"].includes(current) ? "delivered" : current;
  }
  if (incoming === "read") {
    return current === "failed" || current === "skipped" ? current : "read";
  }
  return current === "delivered" || current === "read" || current === "skipped" ? current : "failed";
}

function failureDetails(status: WhatsAppMessageStatus): { code: string | null; message: string | null } {
  const error = status.errors[0];
  if (!error) return { code: null, message: null };
  const parts = [error.title, error.message, error.details].filter((value): value is string => Boolean(value));
  return {
    code: error.code ?? null,
    message: parts.length ? parts.join(": ").slice(0, 2_000) : null,
  };
}

export async function applyStatus(
  db: Database,
  organizationId: string,
  status: WhatsAppMessageStatus,
): Promise<boolean> {
  const at = eventTime(status).toISOString();

  if (status.status === "sent") {
    const rows = await db.execute(sql`
      UPDATE campaign_recipients
      SET
        sent_at = COALESCE(sent_at, ${at}::timestamptz),
        status = CASE
          WHEN status IN ('pending', 'queued', 'submitted', 'sent') THEN 'sent'::recipient_status
          ELSE status
        END,
        updated_at = now()
      WHERE wamid = ${status.wamid}
        AND organization_id = ${organizationId}::uuid
      RETURNING id
    `);
    return rows.length > 0;
  }

  if (status.status === "delivered") {
    const rows = await db.execute(sql`
      UPDATE campaign_recipients
      SET
        delivered_at = COALESCE(delivered_at, ${at}::timestamptz),
        status = CASE
          WHEN status IN ('pending', 'queued', 'submitted', 'sent', 'delivered') THEN 'delivered'::recipient_status
          ELSE status
        END,
        updated_at = now()
      WHERE wamid = ${status.wamid}
        AND organization_id = ${organizationId}::uuid
      RETURNING id
    `);
    return rows.length > 0;
  }

  if (status.status === "read") {
    const rows = await db.execute(sql`
      UPDATE campaign_recipients
      SET
        read_at = COALESCE(read_at, ${at}::timestamptz),
        status = CASE
          WHEN status NOT IN ('failed', 'skipped') THEN 'read'::recipient_status
          ELSE status
        END,
        updated_at = now()
      WHERE wamid = ${status.wamid}
        AND organization_id = ${organizationId}::uuid
      RETURNING id
    `);
    return rows.length > 0;
  }

  const failure = failureDetails(status);
  const rows = await db.execute(sql`
    UPDATE campaign_recipients
    SET
      failed_at = COALESCE(failed_at, ${at}::timestamptz),
      error_code = COALESCE(${failure.code}, error_code),
      last_error = COALESCE(${failure.message}, last_error),
      status = CASE
        WHEN status IN ('delivered', 'read', 'skipped') THEN status
        ELSE 'failed'::recipient_status
      END,
      updated_at = now()
    WHERE wamid = ${status.wamid}
      AND organization_id = ${organizationId}::uuid
    RETURNING id
  `);
  return rows.length > 0;
}
