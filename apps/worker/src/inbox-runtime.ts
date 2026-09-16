import { loadWorkerEnv } from "@wa/config";
import { createDatabase } from "@wa/db";
import { createLogger } from "@wa/observability";
import { processPendingInboxWebhooks } from "./inbox";

const env = loadWorkerEnv();
const database = createDatabase(env.DATABASE_URL);
const log = createLogger({ service: "inbox-runtime" });
const POLL_INTERVAL_MS = 2_000;
let running = false;

async function poll() {
  if (running) return;
  running = true;
  try {
    const processed = await processPendingInboxWebhooks(database.db);
    if (processed > 0) log.info("inbox_webhooks_processed", { count: processed });
  } catch (error) {
    log.error("inbox_webhook_poll_failed", { error });
  } finally {
    running = false;
  }
}

await poll();
const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
timer.unref();

log.info("inbox_runtime_started", { pollIntervalMs: POLL_INTERVAL_MS });

const shutdown = async () => {
  clearInterval(timer);
  await database.client.end();
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
