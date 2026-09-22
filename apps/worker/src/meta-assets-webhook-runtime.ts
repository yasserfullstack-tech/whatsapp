import { and, asc, eq, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { schema } from "@wa/db";
import { parseWhatsAppWebhook } from "@wa/meta/webhooks";
import {
  db,
  log,
  metrics,
  META_ASSET_BATCH_SIZE,
  META_ASSET_MAX_PROCESSING_ATTEMPTS,
  META_ASSET_MAX_RETRY_MS,
  META_ASSET_STALE_PROCESSING_MS,
} from "./meta-assets-runtime-context";
import { applyAssetEvent } from "./meta-assets-webhook-events-runtime";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000);
}

function retryDelayMs(attempt: number): number {
  return Math.min(META_ASSET_MAX_RETRY_MS, 1_000 * (2 ** Math.min(20, Math.max(0, attempt - 1))));
}

async function claimReceipt(eventId: string): Promise<{ attempt: number } | null> {
  await db.insert(schema.metaAssetWebhookReceipts).values({ eventId }).onConflictDoNothing();
  const staleBefore = new Date(Date.now() - META_ASSET_STALE_PROCESSING_MS);
  const [claimed] = await db
    .update(schema.metaAssetWebhookReceipts)
    .set({
      processingStatus: "processing",
      processingAttempts: sql`${schema.metaAssetWebhookReceipts.processingAttempts} + 1`,
      lastError: null,
      nextRetryAt: null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(schema.metaAssetWebhookReceipts.eventId, eventId),
      isNull(schema.metaAssetWebhookReceipts.processedAt),
      or(
        ne(schema.metaAssetWebhookReceipts.processingStatus, "processing"),
        lte(schema.metaAssetWebhookReceipts.updatedAt, staleBefore),
      ),
    ))
    .returning({ attempt: schema.metaAssetWebhookReceipts.processingAttempts });
  return claimed ?? null;
}

async function finishReceipt(eventId: string) {
  await db.update(schema.metaAssetWebhookReceipts).set({
    processingStatus: "processed",
    lastError: null,
    nextRetryAt: null,
    processedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(schema.metaAssetWebhookReceipts.eventId, eventId));
}

async function failReceipt(eventId: string, attempt: number, error: unknown) {
  const deadLetter = attempt >= META_ASSET_MAX_PROCESSING_ATTEMPTS;
  await db.update(schema.metaAssetWebhookReceipts).set({
    processingStatus: deadLetter ? "dead_letter" : "retry",
    lastError: errorText(error),
    nextRetryAt: deadLetter ? null : new Date(Date.now() + retryDelayMs(attempt)),
    updatedAt: new Date(),
  }).where(eq(schema.metaAssetWebhookReceipts.eventId, eventId));
  metrics.incCounter("whatsapp_meta_asset_webhook_events_total", { outcome: deadLetter ? "dead_letter" : "retry" });
}

async function refreshDeadLetterMetric() {
  const [row] = await db.select({ total: sql<number>`count(*)::int` })
    .from(schema.metaAssetWebhookReceipts)
    .where(eq(schema.metaAssetWebhookReceipts.processingStatus, "dead_letter"));
  metrics.setGauge("whatsapp_meta_asset_dead_letter_events", Number(row?.total ?? 0));
}

export async function processMetaAssetWebhookReceipts(): Promise<{ inspected: number; processed: number }> {
  const now = new Date();
  const candidates = await db
    .select({
      id: schema.webhookEvents.id,
      payload: schema.webhookEvents.payload,
      createdAt: schema.webhookEvents.createdAt,
    })
    .from(schema.webhookEvents)
    .leftJoin(schema.metaAssetWebhookReceipts, eq(schema.metaAssetWebhookReceipts.eventId, schema.webhookEvents.id))
    .where(and(
      isNotNull(schema.webhookEvents.processedAt),
      or(
        isNull(schema.metaAssetWebhookReceipts.eventId),
        and(
          isNull(schema.metaAssetWebhookReceipts.processedAt),
          ne(schema.metaAssetWebhookReceipts.processingStatus, "dead_letter"),
          or(
            isNull(schema.metaAssetWebhookReceipts.nextRetryAt),
            lte(schema.metaAssetWebhookReceipts.nextRetryAt, now),
          ),
        ),
      ),
    ))
    .orderBy(asc(schema.webhookEvents.createdAt))
    .limit(META_ASSET_BATCH_SIZE);

  let processed = 0;
  for (const candidate of candidates) {
    const receipt = await claimReceipt(candidate.id);
    if (!receipt) continue;
    try {
      const parsed = parseWhatsAppWebhook(candidate.payload);
      for (const event of parsed.assetEvents) await applyAssetEvent(event, candidate.createdAt);
      await finishReceipt(candidate.id);
      metrics.incCounter("whatsapp_meta_asset_webhook_events_total", { outcome: "processed" });
      processed += 1;
    } catch (error) {
      metrics.incCounter("whatsapp_meta_asset_sync_failures_total", { operation: "webhook" });
      await failReceipt(candidate.id, receipt.attempt, error);
      log.error("meta_asset_webhook_processing_failed", { eventId: candidate.id, attempt: receipt.attempt, error });
    }
  }
  await refreshDeadLetterMetric();
  return { inspected: candidates.length, processed };
}
