import { eq, sql } from "drizzle-orm";
import { loadWorkerEnv } from "@wa/config";
import { createDatabase, schema } from "@wa/db";
import { createLogger, MetricsRegistry } from "@wa/observability";
import { checkStoredBucket, createR2Client } from "@wa/storage";

const env = loadWorkerEnv();
const database = createDatabase(env.DATABASE_URL);
const db = database.db;
const log = createLogger({ service: "operational-probes" });
const metrics = new MetricsRegistry();
const r2 = createR2Client({
  accountId: env.R2_ACCOUNT_ID,
  accessKeyId: env.R2_ACCESS_KEY_ID,
  secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  bucket: env.R2_BUCKET,
});

metrics.defineGauge("whatsapp_r2_up", "Whether the configured Cloudflare R2 bucket is reachable with production credentials");
metrics.defineGauge("whatsapp_email_delivery_probe_up", "Whether notification email delivery state can be queried");
metrics.defineGauge("whatsapp_email_delivery_backlog", "Notification email deliveries by actionable failure state", ["state"]);
metrics.defineCounter("whatsapp_operational_probe_errors_total", "Operational probe refresh failures", ["probe"]);

metrics.setGauge("whatsapp_r2_up", 0);
metrics.setGauge("whatsapp_email_delivery_probe_up", 0);
metrics.setGauge("whatsapp_email_delivery_backlog", 0, { state: "failed" });
metrics.setGauge("whatsapp_email_delivery_backlog", 0, { state: "dead_letter" });

async function refreshR2Probe() {
  try {
    await checkStoredBucket({ client: r2, bucket: env.R2_BUCKET });
    metrics.setGauge("whatsapp_r2_up", 1);
  } catch (error) {
    metrics.setGauge("whatsapp_r2_up", 0);
    metrics.incCounter("whatsapp_operational_probe_errors_total", { probe: "r2" });
    log.warn("r2_health_probe_failed", { error });
  }
}

async function refreshEmailDeliveryProbe() {
  try {
    const rows = await db
      .select({
        status: schema.notificationDeliveries.status,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.notificationDeliveries)
      .where(eq(schema.notificationDeliveries.channel, "email"))
      .groupBy(schema.notificationDeliveries.status);

    let failed = 0;
    let deadLetter = 0;
    for (const row of rows) {
      if (row.status === "failed") failed = Number(row.count);
      if (row.status === "dead_letter") deadLetter = Number(row.count);
    }

    metrics.setGauge("whatsapp_email_delivery_backlog", failed, { state: "failed" });
    metrics.setGauge("whatsapp_email_delivery_backlog", deadLetter, { state: "dead_letter" });
    metrics.setGauge("whatsapp_email_delivery_probe_up", 1);
  } catch (error) {
    metrics.setGauge("whatsapp_email_delivery_probe_up", 0);
    metrics.incCounter("whatsapp_operational_probe_errors_total", { probe: "email_delivery" });
    log.warn("email_delivery_health_probe_failed", { error });
  }
}

async function refreshOperationalProbes() {
  await Promise.all([refreshR2Probe(), refreshEmailDeliveryProbe()]);
}

await refreshOperationalProbes();
const probeTimer = setInterval(() => {
  void refreshOperationalProbes();
}, 60_000);
probeTimer.unref();

async function shutdown() {
  clearInterval(probeTimer);
  r2.destroy();
  await database.client.end();
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
