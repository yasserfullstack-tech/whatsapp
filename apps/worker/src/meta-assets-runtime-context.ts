import { loadWorkerEnv } from "@wa/config";
import { createDatabase } from "@wa/db";
import { createLogger, MetricsRegistry } from "@wa/observability";

export const env = loadWorkerEnv();
export const database = createDatabase(env.DATABASE_URL);
export const db = database.db;
export const log = createLogger({ service: "worker-meta-assets" });
export const metrics = new MetricsRegistry();

export const META_ASSET_WEBHOOK_SCAN_INTERVAL_MS = 5_000;
export const META_ASSET_RECONCILE_INTERVAL_MS = 15 * 60_000;
export const META_ASSET_BATCH_SIZE = 200;
export const META_ASSET_STALE_PROCESSING_MS = 5 * 60_000;
export const META_ASSET_MAX_PROCESSING_ATTEMPTS = 12;
export const META_ASSET_MAX_RETRY_MS = 15 * 60_000;

metrics.defineCounter("whatsapp_meta_asset_webhook_events_total", "Meta asset webhook receipts by outcome", ["outcome"]);
metrics.defineCounter("whatsapp_meta_asset_sync_failures_total", "Meta asset synchronization failures by operation", ["operation"]);
metrics.defineCounter("whatsapp_meta_asset_reconciliation_total", "Meta asset reconciliation runs by outcome", ["outcome"]);
metrics.defineGauge("whatsapp_meta_asset_dead_letter_events", "Meta asset webhook receipts that exhausted processing attempts");
metrics.defineGauge("whatsapp_meta_asset_reconciliation_last_success_timestamp_seconds", "Unix timestamp of the last successful Meta asset reconciliation");
metrics.defineHistogram("whatsapp_meta_asset_reconciliation_duration_seconds", "Meta asset reconciliation duration in seconds");
