import { type Job } from "bullmq";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { createDatabase, schema } from "@wa/db";
import { isMarketingOptOutMessage, parseWhatsAppWebhook, type WhatsAppInboundMessage } from "@wa/meta/webhooks";
import type { WebhookProcessJob } from "@wa/queue";
import {
  MAX_WEBHOOK_PROCESSING_ATTEMPTS,
  UNMATCHED_STATUS_RETRY_WINDOW_MS,
  WEBHOOK_MAX_RETRY_DELAY_MS,
  webhookLog,
  webhookMetrics,
} from "./webhook-runtime-context";
import { applyStatus, eventTime } from "./webhook-status";

type Database = ReturnType<typeof createDatabase>["db"];

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 2_000);
  return String(error).slice(0, 2_000);
}

export function webhookRetryDelayMs(attempt: number): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  return Math.min(WEBHOOK_MAX_RETRY_DELAY_MS, 1_000 * (2 ** Math.min(20, safeAttempt - 1)));
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

async function claimWebhookEvent(db: Database, eventId: string) {
  const [event] = await db
    .update(schema.webhookEvents)
    .set({
      processingAttempts: sql`${schema.webhookEvents.processingAttempts} + 1`,
      processingStatus: "processing",
      processingStartedAt: new Date(),
      lastProcessingError: null,
      nextRetryAt: null,
    })
    .where(and(
      eq(schema.webhookEvents.id, eventId),
      isNull(schema.webhookEvents.processedAt),
      isNull(schema.webhookEvents.deadLetteredAt),
      or(
        sql`${schema.webhookEvents.processingStatus} <> 'processing'`,
        isNull(schema.webhookEvents.processingStartedAt),
      ),
    ))
    .returning({
      id: schema.webhookEvents.id,
      organizationId: schema.webhookEvents.organizationId,
      phoneNumberId: schema.webhookEvents.phoneNumberId,
      payload: schema.webhookEvents.payload,
      processingAttempts: schema.webhookEvents.processingAttempts,
      createdAt: schema.webhookEvents.createdAt,
    });
  return event;
}

async function recordProcessingFailure(
  db: Database,
  eventId: string,
  attempt: number,
  error: unknown,
): Promise<"retry" | "dead_letter"> {
  const message = errorText(error);
  if (attempt >= MAX_WEBHOOK_PROCESSING_ATTEMPTS) {
    await db
      .update(schema.webhookEvents)
      .set({
        processingStatus: "dead_letter",
        processingStartedAt: null,
        lastProcessingError: message,
        nextRetryAt: null,
        deadLetteredAt: new Date(),
      })
      .where(and(
        eq(schema.webhookEvents.id, eventId),
        isNull(schema.webhookEvents.processedAt),
      ));
    webhookMetrics.incCounter("whatsapp_webhook_dead_lettered_total");
    return "dead_letter";
  }

  await db
    .update(schema.webhookEvents)
    .set({
      processingStatus: "retry",
      processingStartedAt: null,
      lastProcessingError: message,
      nextRetryAt: new Date(Date.now() + webhookRetryDelayMs(attempt)),
    })
    .where(and(
      eq(schema.webhookEvents.id, eventId),
      isNull(schema.webhookEvents.processedAt),
      isNull(schema.webhookEvents.deadLetteredAt),
    ));
  webhookMetrics.incCounter("whatsapp_webhook_retries_total");
  return "retry";
}

async function withoutInboxMessages<T extends { organizationId: string; wamid: string }>(
  db: Database,
  statuses: T[],
): Promise<T[]> {
  if (statuses.length === 0) return statuses;
  const known = await db
    .select({ organizationId: schema.inboxMessages.organizationId, wamid: schema.inboxMessages.wamid })
    .from(schema.inboxMessages)
    .where(inArray(schema.inboxMessages.wamid, statuses.map((status) => status.wamid)));
  const knownKeys = new Set(known.map((row) => `${row.organizationId}:${row.wamid}`));
  return statuses.filter((status) => !knownKeys.has(`${status.organizationId}:${status.wamid}`));
}

export async function processWebhookEvent(db: Database, job: Job<WebhookProcessJob>) {
  const event = await claimWebhookEvent(db, job.data.eventId);
  if (!event) return { skipped: true, reason: "already-processed-or-claimed" };

  try {
    const parsed = parseWhatsAppWebhook(event.payload);
    const phoneNumberId = event.phoneNumberId ?? parsed.phoneNumberIds[0] ?? null;
    let organizationId = event.organizationId ?? await organizationForPhone(db, phoneNumberId ?? undefined);

    const unmatchedStatuses: { organizationId: string; wamid: string; status: string }[] = [];
    for (const status of parsed.statuses) {
      const statusOrganizationId = status.phoneNumberId === phoneNumberId && organizationId
        ? organizationId
        : await organizationForPhone(db, status.phoneNumberId);
      if (!statusOrganizationId) continue;
      organizationId ??= statusOrganizationId;
      if (!await applyStatus(db, statusOrganizationId, status)) {
        unmatchedStatuses.push({ organizationId: statusOrganizationId, wamid: status.wamid, status: status.status });
      }
    }

    let optOuts = 0;
    for (const message of parsed.messages) {
      const messageOrganizationId = message.phoneNumberId === phoneNumberId && organizationId
        ? organizationId
        : await organizationForPhone(db, message.phoneNumberId);
      if (!messageOrganizationId) continue;
      organizationId ??= messageOrganizationId;
      if (await applyMarketingOptOut(db, messageOrganizationId, message)) optOuts += 1;
    }

    // Retry only after opt-outs in the same payload are applied, and only for
    // statuses that are not inbox replies (the inbox projection owns those).
    const campaignUnmatched = await withoutInboxMessages(db, unmatchedStatuses);
    if (campaignUnmatched.length > 0) {
      const first = campaignUnmatched[0]!;
      if (Date.now() - event.createdAt.getTime() < UNMATCHED_STATUS_RETRY_WINDOW_MS) {
        throw new Error(`Webhook status ${first.status} for wamid ${first.wamid} has no matching campaign recipient yet`);
      }
      webhookMetrics.incCounter("whatsapp_webhook_unmatched_statuses_total", {}, campaignUnmatched.length);
      webhookLog.info("webhook_status_unmatched", { eventId: event.id, count: campaignUnmatched.length, wamid: first.wamid });
    }

    const processedAt = new Date();
    await db
      .update(schema.webhookEvents)
      .set({
        organizationId,
        phoneNumberId,
        processingStatus: "processed",
        processingStartedAt: null,
        lastProcessingError: null,
        nextRetryAt: null,
        processedAt,
      })
      .where(and(
        eq(schema.webhookEvents.id, event.id),
        isNull(schema.webhookEvents.processedAt),
      ));

    webhookMetrics.incCounter("whatsapp_webhooks_processed_total");
    webhookMetrics.observeHistogram(
      "whatsapp_webhook_processing_latency_seconds",
      Math.max(0, processedAt.getTime() - event.createdAt.getTime()) / 1_000,
    );

    return {
      processedStatuses: parsed.statuses.length,
      processedMessages: parsed.messages.length,
      optOuts,
      organizationId,
      phoneNumberId,
      processingAttempts: event.processingAttempts,
    };
  } catch (error) {
    try {
      const state = await recordProcessingFailure(db, event.id, event.processingAttempts, error);
      webhookLog.warn("webhook_processing_failed", {
        jobId: job.id,
        eventId: event.id,
        organizationId: event.organizationId,
        phoneNumberId: event.phoneNumberId,
        attempt: event.processingAttempts,
        state,
        error,
      });
    } catch (recordError) {
      webhookLog.error("webhook_failure_state_persist_failed", {
        jobId: job.id,
        eventId: event.id,
        attempt: event.processingAttempts,
        error: recordError,
      });
    }
    throw error;
  }
}
