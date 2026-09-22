import { Worker, type Job } from "bullmq";
import type { WorkerEnv } from "@wa/config";
import { createDatabase } from "@wa/db";
import {
  WEBHOOK_QUEUE_NAME,
  createBullConnection,
  createWebhookQueue,
  type WebhookProcessJob,
} from "@wa/queue";
import {
  WEBHOOK_RECONCILE_INTERVAL_MS,
  webhookLog,
} from "./webhook-runtime-context";
import { processWebhookEvent } from "./webhook-processing";
import {
  reconcileWebhookInbox,
  refreshWebhookInboxMetrics,
} from "./webhook-reconciliation";

type Database = ReturnType<typeof createDatabase>["db"];

export {
  MAX_WEBHOOK_PROCESSING_ATTEMPTS,
  WEBHOOK_RECONCILE_INTERVAL_MS,
  WEBHOOK_STALE_PROCESSING_MS,
  WEBHOOK_UNPROCESSED_THRESHOLD_MS,
} from "./webhook-runtime-context";
export {
  webhookRetryDelayMs,
} from "./webhook-processing";
export {
  shouldReconcileWebhookEvent,
  reconcileWebhookInbox,
} from "./webhook-reconciliation";
export {
  webhookRecipientStatusAfter,
} from "./webhook-status";
export type {
  WebhookRecipientStatus,
} from "./webhook-status";

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
        webhookLog.warn("webhook_inbox_reconciled", result);
      }
    } catch (error) {
      webhookLog.error("webhook_reconciliation_failed", { error });
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
