import { Worker, type Job } from "bullmq";
import { and, eq, inArray } from "drizzle-orm";
import { parse } from "csv-parse";
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";
import { loadWorkerEnv } from "@wa/config";
import { createDatabase, schema } from "@wa/db";
import { createLogger, MetricsRegistry } from "@wa/observability";
import {
  CONTACT_IMPORT_QUEUE_NAME,
  createBullConnection,
  createCampaignDispatchQueue,
  createContactImportQueue,
  createRedisClient,
  createSendQueue,
  createWebhookQueue,
  type ContactImportJob,
} from "@wa/queue";
import { createR2Client, getStoredObject } from "@wa/storage";
import { startCampaignWorkers } from "./campaigns";
import { startWebhookWorker } from "./webhooks";

const env = loadWorkerEnv();
const redis = createRedisClient(env.REDIS_URL);
const database = createDatabase(env.DATABASE_URL);
const db = database.db;
const log = createLogger({ service: "worker" });
const metrics = new MetricsRegistry();
const r2 = createR2Client({
  accountId: env.R2_ACCOUNT_ID,
  accessKeyId: env.R2_ACCESS_KEY_ID,
  secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  bucket: env.R2_BUCKET,
});

metrics.defineGauge("whatsapp_worker_active_jobs", "Currently active BullMQ jobs", ["queue"]);
metrics.defineGauge("whatsapp_worker_configured_concurrency", "Configured BullMQ worker concurrency", ["queue"]);
metrics.defineGauge("whatsapp_queue_depth", "BullMQ queue jobs by state", ["queue", "state"]);
metrics.defineCounter("whatsapp_failed_jobs_total", "BullMQ jobs that emitted a failed event", ["queue"]);
metrics.defineCounter("whatsapp_jobs_completed_total", "BullMQ jobs completed successfully", ["queue"]);
metrics.defineCounter("whatsapp_recipient_sends_total", "Recipients successfully submitted to Meta");
metrics.defineCounter("whatsapp_campaigns_launched_total", "Campaign dispatch jobs started for the first time");
metrics.defineCounter("whatsapp_csv_rows_processed_total", "CSV rows processed by completed import jobs");
metrics.defineCounter("whatsapp_metrics_scrape_errors_total", "Worker metrics scrape refresh failures");
metrics.defineHistogram("whatsapp_worker_job_duration_seconds", "BullMQ job execution duration in seconds", ["queue"]);
metrics.defineHistogram("whatsapp_webhook_processing_lag_seconds", "Time from webhook job enqueue to worker start in seconds");
metrics.defineHistogram("whatsapp_worker_readiness_check_duration_seconds", "Worker readiness dependency check latency in seconds", ["dependency"]);

const queueConcurrency = {
  send: env.WORKER_CONCURRENCY,
  webhook: env.WEBHOOK_CONCURRENCY,
  campaign_dispatch: env.CAMPAIGN_DISPATCH_CONCURRENCY,
  contact_import: env.CONTACT_IMPORT_CONCURRENCY,
} as const;

for (const [queue, concurrency] of Object.entries(queueConcurrency)) {
  metrics.setGauge("whatsapp_worker_active_jobs", 0, { queue });
  metrics.setGauge("whatsapp_worker_configured_concurrency", concurrency, { queue });
}

const activeJobs = new Map<string, number>();
function changeActiveJobs(queue: string, delta: number) {
  const next = Math.max(0, (activeJobs.get(queue) ?? 0) + delta);
  activeJobs.set(queue, next);
  metrics.setGauge("whatsapp_worker_active_jobs", next, { queue });
}

function observeJobDuration(queue: string, job: Job | undefined) {
  if (!job) return;
  const startedAt = job.processedOn ?? job.timestamp;
  const durationSeconds = Math.max(0, Date.now() - startedAt) / 1_000;
  metrics.observeHistogram("whatsapp_worker_job_duration_seconds", durationSeconds, { queue });
}

await redis.connect();

const campaignWorkers = startCampaignWorkers({ db, redis, env });
const webhookWorker = startWebhookWorker({ db, env });
const metricQueues = {
  send: createSendQueue(env.REDIS_URL),
  webhook: createWebhookQueue(env.REDIS_URL),
  campaign_dispatch: createCampaignDispatchQueue(env.REDIS_URL),
  contact_import: createContactImportQueue(env.REDIS_URL),
};

type CsvRow = Record<string, string | undefined>;
type ContactInsert = typeof schema.contacts.$inferInsert;

const PHONE_COLUMNS = ["phone", "phone_number", "mobile", "mobile_number", "whatsapp", "whatsapp_number"];
const NAME_COLUMNS = ["name", "full_name", "customer_name", "display_name"];
const MAX_IMPORT_ROWS = 2_000_000;
const INSERT_BATCH_SIZE = 1_000;
const PROGRESS_CHECKPOINT_ROWS = 5_000;

function normalizeColumns(row: CsvRow): CsvRow {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.trim().toLowerCase().replace(/[\s-]+/g, "_"),
      typeof value === "string" ? value.trim() : value,
    ]),
  );
}

function firstValue(row: CsvRow, columns: string[]): string | undefined {
  for (const column of columns) {
    const value = row[column];
    if (value) return value;
  }
  return undefined;
}

function normalizePhone(value: string, country: CountryCode): string | null {
  const cleaned = value.trim().replace(/^'/, "");
  const parsed = parsePhoneNumberFromString(cleaned, country);
  if (!parsed || !parsed.isPossible() || !parsed.isValid()) return null;
  return parsed.number;
}

async function processContactImport(job: ContactImportJob) {
  const [contactImport] = await db
    .select()
    .from(schema.contactImports)
    .where(
      and(
        eq(schema.contactImports.id, job.importId),
        eq(schema.contactImports.organizationId, job.organizationId),
      ),
    )
    .limit(1);

  if (!contactImport) throw new Error(`Contact import ${job.importId} was not found`);
  if (contactImport.status === "completed") return { alreadyCompleted: true };

  await db
    .update(schema.contactImports)
    .set({
      status: "processing",
      startedAt: contactImport.startedAt ?? new Date(),
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.contactImports.id, contactImport.id));

  try {
    const object = await getStoredObject({
      client: r2,
      bucket: env.R2_BUCKET,
      key: contactImport.objectKey,
    });

    const body = object.Body as unknown as { pipe?: (destination: NodeJS.WritableStream) => NodeJS.WritableStream } | undefined;
    if (!body?.pipe) throw new Error("R2 object did not provide a readable stream");

    const parser = parse({
      bom: true,
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      max_record_size: 1024 * 1024,
    });

    body.pipe(parser);

    const defaultCountry = contactImport.defaultCountry.toUpperCase() as CountryCode;
    const resumeFrom = contactImport.processedRows;
    let seenRows = 0;
    let persistedRows = resumeFrom;
    let importedRows = contactImport.importedRows;
    let invalidRows = contactImport.invalidRows;
    let duplicateRows = contactImport.duplicateRows;
    let phoneHeaderFound = resumeFrom > 0;
    let pending: ContactInsert[] = [];

    const flush = async (force = false) => {
      const progressDelta = seenRows - persistedRows;
      if (!force && pending.length < INSERT_BATCH_SIZE && progressDelta < PROGRESS_CHECKPOINT_ROWS) return;

      const batch = pending;
      pending = [];

      await db.transaction(async (tx) => {
        let insertedCount = 0;
        if (batch.length) {
          const inserted = await tx
            .insert(schema.contacts)
            .values(batch)
            .onConflictDoNothing()
            .returning({ id: schema.contacts.id });
          insertedCount = inserted.length;

          if (contactImport.listId) {
            const phoneNumbers = [...new Set(batch.map((row) => row.phoneE164))];
            const contacts = await tx
              .select({ id: schema.contacts.id })
              .from(schema.contacts)
              .where(and(
                eq(schema.contacts.organizationId, contactImport.organizationId),
                inArray(schema.contacts.phoneE164, phoneNumbers),
              ));

            if (contacts.length) {
              await tx
                .insert(schema.contactListMembers)
                .values(contacts.map((contact) => ({
                  organizationId: contactImport.organizationId,
                  listId: contactImport.listId as string,
                  contactId: contact.id,
                })))
                .onConflictDoNothing();
            }
          }
        }

        importedRows += insertedCount;
        duplicateRows += batch.length - insertedCount;

        await tx
          .update(schema.contactImports)
          .set({
            totalRows: seenRows,
            processedRows: seenRows,
            importedRows,
            invalidRows,
            duplicateRows,
            updatedAt: new Date(),
          })
          .where(eq(schema.contactImports.id, contactImport.id));
      });

      persistedRows = seenRows;
    };

    for await (const raw of parser) {
      seenRows += 1;
      if (seenRows > MAX_IMPORT_ROWS) {
        throw new Error(`CSV exceeds the ${MAX_IMPORT_ROWS.toLocaleString()} row safety limit`);
      }

      if (seenRows <= resumeFrom) continue;

      const row = normalizeColumns(raw as CsvRow);
      const rawPhone = firstValue(row, PHONE_COLUMNS);

      if (!phoneHeaderFound) {
        phoneHeaderFound = PHONE_COLUMNS.some((column) => Object.hasOwn(row, column));
        if (!phoneHeaderFound) {
          throw new Error(`CSV needs a phone column. Supported headers: ${PHONE_COLUMNS.join(", ")}`);
        }
      }

      if (!rawPhone) {
        invalidRows += 1;
        await flush();
        continue;
      }

      const phoneE164 = normalizePhone(rawPhone, defaultCountry);
      if (!phoneE164) {
        invalidRows += 1;
        await flush();
        continue;
      }

      pending.push({
        organizationId: contactImport.organizationId,
        phoneE164,
        displayName: firstValue(row, NAME_COLUMNS) ?? null,
        optedIn: true,
        optInSource: contactImport.optInSource,
        optInAt: contactImport.confirmedOptInAt,
      });

      await flush();
    }

    await flush(true);

    await db
      .update(schema.contactImports)
      .set({
        status: "completed",
        totalRows: seenRows,
        processedRows: seenRows,
        importedRows,
        invalidRows,
        duplicateRows,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.contactImports.id, contactImport.id));

    return { totalRows: seenRows, importedRows, invalidRows, duplicateRows };
  } catch (error) {
    await db
      .update(schema.contactImports)
      .set({
        status: "failed",
        errorMessage: error instanceof Error ? error.message.slice(0, 2_000) : "Unknown import error",
        updatedAt: new Date(),
      })
      .where(eq(schema.contactImports.id, contactImport.id));
    throw error;
  }
}

const contactImportWorker = new Worker<ContactImportJob>(
  CONTACT_IMPORT_QUEUE_NAME,
  async (job) => processContactImport(job.data),
  {
    connection: createBullConnection(env.REDIS_URL),
    concurrency: env.CONTACT_IMPORT_CONCURRENCY,
  },
);

function attachLifecycleMetrics(queue: string, worker: Worker) {
  worker.on("error", (error) => {
    log.error("queue_worker_error", { queue, error });
  });
  worker.on("active", () => changeActiveJobs(queue, 1));
  worker.on("completed", (job) => {
    changeActiveJobs(queue, -1);
    metrics.incCounter("whatsapp_jobs_completed_total", { queue });
    observeJobDuration(queue, job);
  });
  worker.on("failed", (job) => {
    changeActiveJobs(queue, -1);
    metrics.incCounter("whatsapp_failed_jobs_total", { queue });
    observeJobDuration(queue, job);
  });
}

attachLifecycleMetrics("send", campaignWorkers.sendWorker);
attachLifecycleMetrics("campaign_dispatch", campaignWorkers.campaignDispatchWorker);
attachLifecycleMetrics("webhook", webhookWorker);
attachLifecycleMetrics("contact_import", contactImportWorker);

campaignWorkers.sendWorker.on("completed", (_job, result) => {
  if (result && typeof result === "object" && "wamid" in result) {
    metrics.incCounter("whatsapp_recipient_sends_total");
  }
});

campaignWorkers.campaignDispatchWorker.on("active", (job) => {
  if (job.attemptsMade === 0) metrics.incCounter("whatsapp_campaigns_launched_total");
});

webhookWorker.on("active", (job) => {
  metrics.observeHistogram("whatsapp_webhook_processing_lag_seconds", Math.max(0, Date.now() - job.timestamp) / 1_000);
});

contactImportWorker.on("completed", (_job, result) => {
  if (result && typeof result === "object" && "totalRows" in result && typeof result.totalRows === "number") {
    metrics.incCounter("whatsapp_csv_rows_processed_total", {}, result.totalRows);
  }
});

campaignWorkers.sendWorker.on("failed", (job, error) => {
  log.error("send_job_failed", {
    jobId: job?.id,
    organizationId: job?.data.organizationId,
    campaignId: job?.data.campaignId,
    recipientId: job?.data.recipientId,
    error,
  });
});

campaignWorkers.campaignDispatchWorker.on("failed", (job, error) => {
  log.error("campaign_dispatch_job_failed", {
    jobId: job?.id,
    organizationId: job?.data.organizationId,
    campaignId: job?.data.campaignId,
    error,
  });
});

webhookWorker.on("failed", (job, error) => {
  log.error("webhook_job_failed", {
    jobId: job?.id,
    eventId: job?.data.eventId,
    error,
  });
});

contactImportWorker.on("failed", (job, error) => {
  log.error("contact_import_job_failed", {
    jobId: job?.id,
    organizationId: job?.data.organizationId,
    importId: job?.data.importId,
    error,
  });
});

async function refreshQueueMetrics() {
  for (const [queue, client] of Object.entries(metricQueues)) {
    const counts = await client.getJobCounts("wait", "active", "delayed", "failed");
    metrics.setGauge("whatsapp_queue_depth", counts.wait ?? 0, { queue, state: "wait" });
    metrics.setGauge("whatsapp_queue_depth", counts.active ?? 0, { queue, state: "active" });
    metrics.setGauge("whatsapp_queue_depth", counts.delayed ?? 0, { queue, state: "delayed" });
    metrics.setGauge("whatsapp_queue_depth", counts.failed ?? 0, { queue, state: "failed" });
  }
}

async function readiness() {
  const checks: Record<string, "ok" | "error"> = { database: "ok", redis: "ok" };

  const dbStartedAt = performance.now();
  try {
    await database.client`select 1`;
  } catch (error) {
    checks.database = "error";
    log.error("readiness_check_failed", { dependency: "database", error });
  } finally {
    metrics.observeHistogram("whatsapp_worker_readiness_check_duration_seconds", (performance.now() - dbStartedAt) / 1_000, {
      dependency: "database",
    });
  }

  const redisStartedAt = performance.now();
  try {
    await redis.ping();
  } catch (error) {
    checks.redis = "error";
    log.error("readiness_check_failed", { dependency: "redis", error });
  } finally {
    metrics.observeHistogram("whatsapp_worker_readiness_check_duration_seconds", (performance.now() - redisStartedAt) / 1_000, {
      dependency: "redis",
    });
  }

  return {
    ok: checks.database === "ok" && checks.redis === "ok",
    service: "worker",
    checks,
    timestamp: new Date().toISOString(),
  };
}

const observabilityServer = Bun.serve({
  port: env.WORKER_METRICS_PORT,
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405 });

    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "worker", timestamp: new Date().toISOString() });
    }

    if (url.pathname === "/ready") {
      const body = await readiness();
      return Response.json(body, { status: body.ok ? 200 : 503 });
    }

    if (url.pathname === "/metrics") {
      try {
        await refreshQueueMetrics();
      } catch (error) {
        metrics.incCounter("whatsapp_metrics_scrape_errors_total");
        log.warn("queue_metrics_refresh_failed", { error });
      }
      return new Response(metrics.render(), {
        headers: { "content-type": metrics.contentType },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
});

log.info("service_started", {
  sendConcurrency: env.WORKER_CONCURRENCY,
  webhookConcurrency: env.WEBHOOK_CONCURRENCY,
  campaignDispatchConcurrency: env.CAMPAIGN_DISPATCH_CONCURRENCY,
  contactImportConcurrency: env.CONTACT_IMPORT_CONCURRENCY,
  defaultMps: env.DEFAULT_META_MPS,
  observabilityUrl: observabilityServer.url.toString(),
});

const shutdown = async () => {
  log.info("service_stopping");
  observabilityServer.stop(true);
  await Promise.all([
    campaignWorkers.close(),
    webhookWorker.close(true),
    contactImportWorker.close(true),
    ...Object.values(metricQueues).map((queue) => queue.close()),
  ]);
  await redis.quit();
  await database.client.end();
  log.info("service_stopped");
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
