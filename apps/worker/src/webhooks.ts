import { Worker, type Job } from "bullmq";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { WorkerEnv } from "@wa/config";
import { createDatabase, schema } from "@wa/db";
import {
  isMarketingOptOutMessage,
  parseWhatsAppWebhook,
  type WhatsAppInboundMessage,
  type WhatsAppMessageStatus,
} from "@wa/meta/webhooks";
import { WEBHOOK_QUEUE_NAME, createBullConnection, type WebhookProcessJob } from "@wa/queue";

type Database = ReturnType<typeof createDatabase>["db"];

function eventTime(status: WhatsAppMessageStatus | WhatsAppInboundMessage): Date {
  if (status.timestampSeconds !== undefined) {
    const date = new Date(status.timestampSeconds * 1_000);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return new Date();
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

async function applyStatus(db: Database, status: WhatsAppMessageStatus): Promise<void> {
  const at = eventTime(status);

  if (status.status === "sent") {
    await db.execute(sql`
      UPDATE campaign_recipients
      SET
        sent_at = COALESCE(sent_at, ${at}),
        status = CASE
          WHEN status IN ('pending', 'queued', 'submitted', 'sent') THEN 'sent'::recipient_status
          ELSE status
        END,
        updated_at = now()
      WHERE wamid = ${status.wamid}
    `);
    return;
  }

  if (status.status === "delivered") {
    await db.execute(sql`
      UPDATE campaign_recipients
      SET
        delivered_at = COALESCE(delivered_at, ${at}),
        status = CASE
          WHEN status IN ('pending', 'queued', 'submitted', 'sent', 'delivered') THEN 'delivered'::recipient_status
          ELSE status
        END,
        updated_at = now()
      WHERE wamid = ${status.wamid}
    `);
    return;
  }

  if (status.status === "read") {
    await db.execute(sql`
      UPDATE campaign_recipients
      SET
        read_at = COALESCE(read_at, ${at}),
        status = CASE
          WHEN status <> 'failed' THEN 'read'::recipient_status
          ELSE status
        END,
        updated_at = now()
      WHERE wamid = ${status.wamid}
    `);
    return;
  }

  const failure = failureDetails(status);
  await db.execute(sql`
    UPDATE campaign_recipients
    SET
      failed_at = COALESCE(failed_at, ${at}),
      error_code = COALESCE(${failure.code}, error_code),
      last_error = COALESCE(${failure.message}, last_error),
      status = CASE
        WHEN status IN ('delivered', 'read') THEN status
        ELSE 'failed'::recipient_status
      END,
      updated_at = now()
    WHERE wamid = ${status.wamid}
  `);
}

function normalizedSender(from: string): string | null {
  const digits = from.replace(/\D/g, "");
  return digits ? `+${digits}` : null;
}

async function organizationForPhone(db: Database, phoneNumberId: string | undefined): Promise<string | null> {
  if (!phoneNumberId) return null;
  const [phone] = await db
    .select({ organizationId: schema.whatsappPhoneNumbers.organizationId })
    .from(schema.whatsappPhoneNumbers)
    .where(eq(schema.whatsappPhoneNumbers.phoneNumberId, phoneNumberId))
    .limit(1);
  return phone?.organizationId ?? null;
}

async function applyMarketingOptOut(
  db: Database,
  organizationId: string,
  message: WhatsAppInboundMessage,
): Promise<boolean> {
  if (!isMarketingOptOutMessage(message)) return false;
  const phoneE164 = normalizedSender(message.from);
  if (!phoneE164) return false;

  const at = eventTime(message);
  const source = `whatsapp_${message.type}`;

  await db.transaction(async (tx) => {
    const [contact] = await tx
      .select({ id: schema.contacts.id })
      .from(schema.contacts)
      .where(and(
        eq(schema.contacts.organizationId, organizationId),
        eq(schema.contacts.phoneE164, phoneE164),
      ))
      .limit(1);

    await tx
      .insert(schema.suppressionList)
      .values({
        organizationId,
        phoneE164,
        reason: "marketing_opt_out",
        source,
        sourceMessageId: message.messageId,
        suppressedAt: at,
      })
      .onConflictDoUpdate({
        target: [schema.suppressionList.organizationId, schema.suppressionList.phoneE164],
        set: {
          reason: "marketing_opt_out",
          source,
          sourceMessageId: message.messageId,
          suppressedAt: at,
          updatedAt: new Date(),
        },
      });

    await tx
      .insert(schema.contactConsentEvents)
      .values({
        organizationId,
        contactId: contact?.id ?? null,
        phoneE164,
        eventType: "opt_out",
        source,
        sourceMessageId: message.messageId,
        occurredAt: at,
      })
      .onConflictDoNothing({
        target: [schema.contactConsentEvents.organizationId, schema.contactConsentEvents.sourceMessageId],
      });

    await tx
      .update(schema.contacts)
      .set({
        optedIn: false,
        unsubscribedAt: at,
        updatedAt: new Date(),
      })
      .where(and(
        eq(schema.contacts.organizationId, organizationId),
        eq(schema.contacts.phoneE164, phoneE164),
      ));

    await tx
      .update(schema.campaignRecipients)
      .set({
        status: "skipped",
        errorCode: "SUPPRESSED",
        lastError: "Recipient opted out through WhatsApp",
        updatedAt: new Date(),
      })
      .where(and(
        eq(schema.campaignRecipients.organizationId, organizationId),
        eq(schema.campaignRecipients.phoneE164, phoneE164),
        inArray(schema.campaignRecipients.status, ["pending", "queued"]),
      ));
  });

  return true;
}

export function startWebhookWorker(input: { db: Database; env: WorkerEnv }) {
  const { db, env } = input;

  return new Worker<WebhookProcessJob>(
    WEBHOOK_QUEUE_NAME,
    async (job: Job<WebhookProcessJob>) => {
      const [event] = await db
        .select({
          id: schema.webhookEvents.id,
          organizationId: schema.webhookEvents.organizationId,
          phoneNumberId: schema.webhookEvents.phoneNumberId,
          payload: schema.webhookEvents.payload,
          processedAt: schema.webhookEvents.processedAt,
        })
        .from(schema.webhookEvents)
        .where(eq(schema.webhookEvents.id, job.data.eventId))
        .limit(1);

      if (!event) return { skipped: true, reason: "event-not-found" };
      if (event.processedAt) return { skipped: true, reason: "already-processed" };

      const parsed = parseWhatsAppWebhook(event.payload);
      const phoneNumberId = event.phoneNumberId ?? parsed.phoneNumberIds[0] ?? null;
      let organizationId = event.organizationId ?? await organizationForPhone(db, phoneNumberId ?? undefined);

      for (const status of parsed.statuses) {
        await applyStatus(db, status);
      }

      let optOuts = 0;
      for (const message of parsed.messages) {
        const messageOrganizationId = message.phoneNumberId === phoneNumberId
          ? organizationId
          : await organizationForPhone(db, message.phoneNumberId);
        if (!messageOrganizationId) continue;
        organizationId ??= messageOrganizationId;
        if (await applyMarketingOptOut(db, messageOrganizationId, message)) optOuts += 1;
      }

      const processedAt = new Date();
      await db
        .update(schema.webhookEvents)
        .set({
          organizationId,
          phoneNumberId,
          processedAt,
        })
        .where(and(
          eq(schema.webhookEvents.id, event.id),
          isNull(schema.webhookEvents.processedAt),
        ));

      return {
        processedStatuses: parsed.statuses.length,
        processedMessages: parsed.messages.length,
        optOuts,
        organizationId,
        phoneNumberId,
      };
    },
    {
      connection: createBullConnection(env.REDIS_URL),
      concurrency: env.WEBHOOK_CONCURRENCY,
    },
  );
}
