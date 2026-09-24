import { createLogger, MetricsRegistry } from "@wa/observability";

export const MAX_WEBHOOK_PROCESSING_ATTEMPTS = 12;
export const WEBHOOK_RECONCILE_INTERVAL_MS = 15_000;
export const WEBHOOK_STALE_PROCESSING_MS = 60_000;
export const WEBHOOK_UNPROCESSED_THRESHOLD_MS = 30_000;
export const WEBHOOK_RECONCILE_BATCH_SIZE = 500;
export const WEBHOOK_MAX_RETRY_DELAY_MS = 5 * 60_000;
// A status can outrun the send worker persisting its wamid by seconds. Past this
// window an unmatched status belongs to a message this app never sent.
export const UNMATCHED_STATUS_RETRY_WINDOW_MS = 2 * 60_000;

export const webhookLog = createLogger({ service: "worker" });
export const webhookMetrics = new MetricsRegistry();

webhookMetrics.defineCounter("whatsapp_webhooks_processed_total", "Durable webhook inbox events processed successfully");
webhookMetrics.defineCounter("whatsapp_webhook_retries_total", "Webhook processing attempts scheduled for retry");
webhookMetrics.defineCounter("whatsapp_webhook_unmatched_statuses_total", "Status webhooks accepted without a matching campaign recipient after the retry window");
webhookMetrics.defineCounter("whatsapp_webhook_dead_lettered_total", "Webhook events moved to the durable dead letter state");
webhookMetrics.defineCounter("whatsapp_webhook_reconciled_total", "Webhook inbox events requeued by reconciliation", ["reason"]);
webhookMetrics.defineGauge("whatsapp_webhook_failed_events", "Webhook inbox events waiting for retry after a processing failure");
webhookMetrics.defineGauge("whatsapp_webhook_dead_letter_events", "Webhook inbox events currently in the durable dead letter state");
webhookMetrics.defineGauge("whatsapp_webhook_oldest_unprocessed_age_seconds", "Age in seconds of the oldest non-dead-letter unprocessed webhook event");
webhookMetrics.defineHistogram("whatsapp_webhook_processing_latency_seconds", "Time from webhook persistence to successful processing");
