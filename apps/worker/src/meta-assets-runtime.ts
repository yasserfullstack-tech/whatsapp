import {
  log,
  metrics,
  META_ASSET_RECONCILE_INTERVAL_MS,
  META_ASSET_WEBHOOK_SCAN_INTERVAL_MS,
} from "./meta-assets-runtime-context";
import { reconcileMetaAssets } from "./meta-assets-reconciliation-runtime";
import { processMetaAssetWebhookReceipts } from "./meta-assets-webhook-runtime";

export {
  META_ASSET_RECONCILE_INTERVAL_MS,
  META_ASSET_WEBHOOK_SCAN_INTERVAL_MS,
} from "./meta-assets-runtime-context";
export { reconcileMetaAssets } from "./meta-assets-reconciliation-runtime";
export { processMetaAssetWebhookReceipts } from "./meta-assets-webhook-runtime";

let scanRunning = false;
async function scan() {
  if (scanRunning) return;
  scanRunning = true;
  try {
    const result = await processMetaAssetWebhookReceipts();
    if (result.processed > 0) log.info("meta_asset_webhooks_processed", result);
  } catch (error) {
    metrics.incCounter("whatsapp_meta_asset_sync_failures_total", { operation: "scanner" });
    log.error("meta_asset_webhook_scanner_failed", { error });
  } finally {
    scanRunning = false;
  }
}

let reconciliationRunning = false;
async function reconcile() {
  if (reconciliationRunning) return;
  reconciliationRunning = true;
  const startedAt = performance.now();
  try {
    const result = await reconcileMetaAssets();
    const outcome = result.failures > 0 ? "partial" : "success";
    metrics.incCounter("whatsapp_meta_asset_reconciliation_total", { outcome });
    if (result.failures === 0) {
      metrics.setGauge("whatsapp_meta_asset_reconciliation_last_success_timestamp_seconds", Date.now() / 1_000);
      log.info("meta_asset_reconciliation_completed", result);
    } else {
      log.warn("meta_asset_reconciliation_completed_with_failures", result);
    }
  } catch (error) {
    metrics.incCounter("whatsapp_meta_asset_reconciliation_total", { outcome: "failed" });
    metrics.incCounter("whatsapp_meta_asset_sync_failures_total", { operation: "reconciliation" });
    log.error("meta_asset_reconciliation_failed", { error });
  } finally {
    metrics.observeHistogram("whatsapp_meta_asset_reconciliation_duration_seconds", (performance.now() - startedAt) / 1_000);
    reconciliationRunning = false;
  }
}

void scan();
void reconcile();
const scanInterval = setInterval(() => void scan(), META_ASSET_WEBHOOK_SCAN_INTERVAL_MS);
const reconciliationInterval = setInterval(() => void reconcile(), META_ASSET_RECONCILE_INTERVAL_MS);
scanInterval.unref?.();
reconciliationInterval.unref?.();
