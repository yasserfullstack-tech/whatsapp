import type { Queue } from "bullmq";
import { and, eq, isNull, lt, lte, or, sql } from "drizzle-orm";
import { createDatabase, schema } from "@wa/db";
import type { WebhookProcessJob } from "@wa/queue";
import {
  WEBHOOK_RECONCILE_BATCH_SIZE,
  WEBHOOK_STALE_PROCESSING_MS,
  WEBHOOK_UNPROCESSED_THRESHOLD_MS,
  webhookLog,
  webhookMetrics,
} from "./webhook-runtime-context";

type Database = ReturnType<typeof createDatabase>["db"];
type WebhookQueue = Queue<WebhookProcessJob>;

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

export async function refreshWebhookInboxMetrics(db: Database): Promise<void> {
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
        EXTRACT(EPOCH FROM (
          now() - (MIN(${schema.webhookEvents.createdAt}) FILTER (
            WHERE ${schema.webhookEvents.processedAt} IS NULL
              AND ${schema.webhookEvents.deadLetteredAt} IS NULL
          ))
        )),
        0
      )::double precision`,
    })
    .from(schema.webhookEvents);

  webhookMetrics.setGauge("whatsapp_webhook_failed_events", Number(row?.failedEvents ?? 0));
  webhookMetrics.setGauge("whatsapp_webhook_dead_letter_events", Number(row?.deadLetterEvents ?? 0));
  webhookMetrics.setGauge(
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

    const jobId = `webhook-${event.id}`;
    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (["active", "waiting", "delayed", "prioritized", "waiting-children"].includes(state)) {
        continue;
      }
      try {
        await existing.remove();
      } catch (error) {
        webhookLog.warn("webhook_reconciliation_terminal_job_remove_failed", {
          eventId: event.id,
          jobId,
          state,
          error,
        });
        continue;
      }
    }

    if (reason === "stale_processing") {
      if (!event.processingStartedAt) continue;
      const [recovered] = await db
        .update(schema.webhookEvents)
        .set({
          processingStatus: "retry",
          processingStartedAt: null,
          lastProcessingError: "Reconciliation recovered a stale webhook processing claim",
          nextRetryAt: now,
        })
        .where(and(
          eq(schema.webhookEvents.id, event.id),
          eq(schema.webhookEvents.processingStatus, "processing"),
          eq(schema.webhookEvents.processingStartedAt, event.processingStartedAt),
          isNull(schema.webhookEvents.processedAt),
          isNull(schema.webhookEvents.deadLetteredAt),
        ))
        .returning({ id: schema.webhookEvents.id });
      if (!recovered) continue;
    }

    await queue.add(
      "process-meta-webhook",
      { eventId: event.id },
      { jobId },
    );
    webhookMetrics.incCounter("whatsapp_webhook_reconciled_total", { reason });
    requeued += 1;
  }

  return { inspected: candidates.length, requeued };
}
