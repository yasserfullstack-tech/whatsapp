import { Worker, type Job, type Queue } from "bullmq";
import {
  and,
  eq,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { WorkerEnv } from "@wa/config";
import { createDatabase, schema } from "@wa/db";
import {
  isMarketingOptOutMessage,
  parseWhatsAppWebhook,
  type WhatsAppInboundMessage,
  type WhatsAppMessageStatus,
} from "@wa/meta/webhooks";
import { createLogger, MetricsRegistry } from "@wa/observability";
import {
  WEBHOOK_QUEUE_NAME,
  createBullConnection,
  createWebhookQueue,
  type WebhookProcessJob,
} from "@wa/queue";

type Database = ReturnType<typeof createDatabase>["db"];
type WebhookQueue = Queue<WebhookProcessJob>;

export const MAX_WEBHOOK_PROCESSING_ATTEMPTS = 12;
export const WEBHOOK_RECONCILE_INTERVAL_MS = 15_000;
export const WEBHOOK_STALE_PROCESSING_MS = 60_000;
export const WEBHOOK_UNPROCESSED_THRESHOLD_MS = 30_000;
const WEBHOOK_RECONCILE_BATCH_SIZE = 500;
const WEBHOOK_MAX_RETRY_DELAY_MS = 5 * 60_000;

const log = createLogger({ service: "worker" });
const metrics = new MetricsRegistry();

metrics.defineCounter("whatsapp_webhooks_processed_total", "Durable webhook inbox events processed successfully");
metrics.defineCounter("whatsapp_webhook_retries_total", "Webhook processing attempts scheduled for retry");
metrics.defineCounter("whatsapp_webhook_dead_lettered_total", "Webhook events moved to the durable dead letter state");
metrics.defineCounter("whatsapp_webhook_reconciled_total", "Webhook inbox events requeued by reconciliation", ["reason"]);
metrics.defineGauge("whatsapp_webhook_failed_events", "Webhook inbox events waiting for retry after a processing failure");
metrics.defineGauge("whatsapp_webhook_dead_letter_events", "Webhook inbox events currently in the durable dead letter state");
metrics.defineGauge("whatsapp_webhook_oldest_unprocessed_age_seconds", "Age in seconds of the oldest non-dead-letter unprocessed webhook event");
metrics.defineHistogram("whatsapp_webhook_processing_latency_seconds", "Time from webhook persistence to successful processing");

function eventTime(status: WhatsAppMessageStatus | WhatsAppInboundMessage): Date {
  if (status.timestampSeconds !== undefined) {
    const date = new Date(status.timestampSeconds * 1_000);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return new Date();
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 2_000);
  return String(error).slice(0, 2_000);
}

export function webhookRetryDelayMs(attempt: number): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  return Math.min(WEBHOOK_MAX_RETRY_DELAY_MS, 1_000 * (2 ** Math.min(20, safeAttempt - 1)));
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
    return current === "failed" ? "failed" : "read";
  }
  return current === "delivered" || current === "read" ? current : "failed";
}

export function shouldReconcileWebhookEvent(
  event: {
    processingStatus: string;
    createdAt: Date;
    processingStartedAt: Date | null;
    nextRetryAt: Date | null;
  },
  now: Date,
): "never_queued" | "stale_processing" | "retry_due" | null {
  const nowMs = now.getTime();
  if (
    event.processingStatus === "processing" &&
    event.processingStartedAt &&
    nowMs - event.processingStartedAt.getTime() >= WEBHOOK_STALE_PROCESSING_MS
  ) {
    return "stale_processing";
  }
  if (
    event.processingStatus === "retry" &&
    (!event.nextRetryAt || event.nextRetryAt.getTime() <= nowMs)
  ) {
    return "retry_due";
  }
  if (
    event.processingStatus === "pending" &&
    nowMs - event.createdAt.getTime() >= WEBHOOK_UNPROCESSED_THRESHOLD_MS
  ) {
    return "never_queued";
  }
  return null;
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

async function applyStatus(
  db: Database,
  organizationId: string,
  status: WhatsAppMessageStatus,
): Promise<void> {
  const at = eventTime(status).toISOString();

  if (status.status === "sent") {
    await db.execute(sql`
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
    `);
    return;
  }

  if (status.status === "delivered") {
    await db.execute(sql`
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
    `);
    return;
  }

  if (status.status === "read") {
    await db.execute(sql`
      UPDATE campaign_recipients
      SET
        read_at = COALESCE(read_at, ${at}::timestamptz),
        status = CASE
          WHEN status <> 'failed' THEN 'read'::recipient_status
          ELSE status
        END,
        updated_at = now()
      WHERE wamid = ${status.wamid}
        AND organization_id = ${organizationId}::uuid
    `);
    return;
  }

  const failure = failureDetails(status);
  await db.execute(sql`
    UPDATE campaign_recipients
    SET
      failed_at = COALESCE(failed_at, ${at}::timestamptz),
      error_code = COALESCE(${failure.code}, error_code),
      last_error = COALESCE(${failure.message}, last_error),
      status = CASE
        WHEN status IN ('delivered', 'read') THEN status
        ELSE 'failed'::recipient_status
      END,
      updated_at = now()
    WHERE wamid = ${status.wamid}
      AND organization_id = ${organizationId}::uuid
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

async function claimWebhookEvent(db: Database, eventId: string) {
  const staleBefore = new Date(Date.now() - WEBHOOK_STALE_PROCESSING_MS);
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
        lt(schema.webhookEvents.processingStartedAt, staleBefore),
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
    metrics.incCounter("whatsapp_webhook_dead_lettered_total");
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
  metrics.incCounter("whatsapp_webhook_retries_total");
  return "retry";
}

async function processWebhookEvent(db: Database, job: Job<WebhookProcessJob>) {
  const event = await claimWebhookEvent(db, job.data.eventId);
  if (!event) return { skipped: true, reason: "already-processed-or-claimed" };

  try {
    const parsed = parseWhatsAppWebhook(event.payload);
    const phoneNumberId = event.phoneNumberId ?? parsed.phoneNumberIds[0] ?? null;
    let organizationId = event.organizationId ?? await organizationForPhone(db, phoneNumberId ?? undefined);

    for (const status of parsed.statuses) {
      const statusOrganizationId = status.phoneNumberId === phoneNumberId && organizationId
        ? organizationId
        : await organizationForPhone(db, status.phoneNumberId);
      if (!statusOrganizationId) continue;
      organizationId ??= statusOrganizationId;
      await applyStatus(db, statusOrganizationId, status);
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

    metrics.incCounter("whatsapp_webhooks_processed_total");
    metrics.observeHistogram(
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
      log.warn("webhook_processing_failed", {
        jobId: job.id,
        eventId: event.id,
        organizationId: event.organizationId,
        phoneNumberId: event.phoneNumberId,
        attempt: event.processingAttempts,
        state,
        error,
      });
    } catch (recordError) {
      log.error("webhook_failure_state_persist_failed", {
        jobId: job.id,
        eventId: event.id,
        attempt: event.processingAttempts,
        error: recordError,
      });
    }
    throw error;
  }
}

async function refreshWebhookInboxMetrics(db: Database): Promise<void> {
  const [row] = await db
    .select({
      failedEvents: sql<number>`count(*) FILTER (
        WHERE ${schema.webhookEvents.processedAt} IS NULL
          AND ${schema.webhookEvents.processingStatus} = 'retry'
      )::int`,
      deadLetterEvents: sql<number>`count(*) FILTER (
        WHERE ${schema.webhookEvents.deadLetteredAt} IS NOT NULL
      )::int`,
      oldestUnprocessedAgeSeconds: sql<number>`COALESCE(
        EXTRACT(EPOCH FROM (now() - MIN(${schema.webhookEvents.createdAt}))) FILTER (
          WHERE ${schema.webhookEvents.processedAt} IS NULL
            AND ${schema.webhookEvents.deadLetteredAt} IS NULL
        ),
        0
      )::double precision`,
    })
    .from(schema.webhookEvents);

  metrics.setGauge("whatsapp_webhook_failed_events", Number(row?.failedEvents ?? 0));
  metrics.setGauge("whatsapp_webhook_dead_letter_events", Number(row?.deadLetterEvents ?? 0));
  metrics.setGauge(
    "whatsapp_webhook_oldest_unprocessed_age_seconds",
    Math.max(0, Number(row?.oldestUnprocessedAgeSeconds ?? 0)),
  );
}

export async function reconcileWebhookInbox(input: {
  db: Database;
  queue: WebhookQueue;
  now?: Date;
}): Promise<{ inspected: number; requeued: number }> {
  const { db, queue } = input;
  const now = input.now ?? new Date();
  const staleBefore = new Date(now.getTime() - WEBHOOK_STALE_PROCESSING_MS);
  const pendingBefore = new Date(now.getTime() - WEBHOOK_UNPROCESSED_THRESHOLD_MS);

  const candidates = await db
    .select({
      id: schema.webhookEvents.id,
      processingStatus: schema.webhookEvents.processingStatus,
      processingStartedAt: schema.webhookEvents.processingStartedAt,
      nextRetryAt: schema.webhookEvents.nextRetryAt,
      createdAt: schema.webhookEvents.createdAt,
    })
    .from(schema.webhookEvents)
    .where(and(
      isNull(schema.webhookEvents.processedAt),
      isNull(schema.webhookEvents.deadLetteredAt),
      or(
        and(
          eq(schema.webhookEvents.processingStatus, "pending"),
          lt(schema.webhookEvents.createdAt, pendingBefore),
        ),
        and(
          eq(schema.webhookEvents.processingStatus, "retry"),
          or(
            isNull(schema.webhookEvents.nextRetryAt),
            lte(schema.webhookEvents.nextRetryAt, now),
          ),
        ),
        and(
          eq(schema.webhookEvents.processingStatus, "processing"),
          lt(schema.webhookEvents.processingStartedAt, staleBefore),
        ),
      ),
    ))
    .limit(WEBHOOK_RECONCILE_BATCH_SIZE);

  let requeued = 0;
  for (const event of candidates) {
    const reason = shouldReconcileWebhookEvent(event, now);
    if (!reason) continue;

    if (reason === "stale_processing") {
      await db
        .update(schema.webhookEvents)
        .set({
          processingStatus: "retry",
          processingStartedAt: null,
          lastProcessingError: "Reconciliation recovered a stale webhook processing claim",
          nextRetryAt: now,
        })
        .where(and(
          eq(schema.webhookEvents.id, event.id),
          isNull(schema.webhookEvents.processedAt),
          isNull(schema.webhookEvents.deadLetteredAt),
        ));
    } else {
      const existing = await queue.getJob(`webhook-${event.id}`);
      if (existing) continue;
    }

    await queue.add(
      "process-meta-webhook",
      { eventId: event.id },
      {
        jobId: reason === "stale_processing"
          ? `webhook-${event.id}-reconcile-${Math.floor(now.getTime() / WEBHOOK_RECONCILE_INTERVAL_MS)}`
          : `webhook-${event.id}`,
      },
    );
    metrics.incCounter("whatsapp_webhook_reconciled_total", { reason });
    requeued += 1;
  }

  return { inspected: candidates.length, requeued };
}

export function startWebhookWorker(input: { db: Database; env: WorkerEnv }) {
  const { db, env } = input;
  const reconciliationQueue = createWebhookQueue(env.REDIS_URL);

  const worker = new Worker<WebhookProcessJob>(
    WEBHOOK_QUEUE_NAME,
    async (job: Job<WebhookProcessJob>) => processWebhookEvent(db, job),
    {
      connection: createBullConnection(env.REDIS_URL),
      concurrency: env.WEBHOOK_CONCURRENCY,
    },
  );

  let reconciliationRunning = false;
  const reconcile = async () => {
    if (reconciliationRunning) return;
    reconciliationRunning = true;
    try {
      const result = await reconcileWebhookInbox({ db, queue: reconciliationQueue });
      await refreshWebhookInboxMetrics(db);
      if (result.requeued > 0) {
        log.warn("webhook_inbox_reconciled", result);
      }
    } catch (error) {
      log.error("webhook_reconciliation_failed", { error });
    } finally {
      reconciliationRunning = false;
    }
  };

  void reconcile();
  const interval = setInterval(() => void reconcile(), WEBHOOK_RECONCILE_INTERVAL_MS);
  interval.unref?.();

  worker.on("closed", () => {
    clearInterval(interval);
    void reconciliationQueue.close();
  });

  return worker;
}
