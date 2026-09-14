import { asc, eq } from "drizzle-orm";
import { loadWorkerEnv } from "@wa/config";
import { createDatabase, schema } from "@wa/db";
import { createLogger } from "@wa/observability";
import { createDataExportQueue } from "@wa/queue";

const env = loadWorkerEnv();
const database = createDatabase(env.DATABASE_URL);
const queue = createDataExportQueue(env.REDIS_URL);
const log = createLogger({ service: "worker-data-export-reconciler" });

async function reconcileQueuedExports() {
  const jobs = await database.db.select({
    id: schema.dataExportJobs.id,
    organizationId: schema.dataExportJobs.organizationId,
  }).from(schema.dataExportJobs)
    .where(eq(schema.dataExportJobs.status, "queued"))
    .orderBy(asc(schema.dataExportJobs.createdAt))
    .limit(250);

  for (const job of jobs) {
    await queue.add("export", { organizationId: job.organizationId, exportJobId: job.id }, { jobId: `data-export-${job.id}` });
  }
}

const initial = setTimeout(() => void reconcileQueuedExports().catch((error) => log.error("data_export_reconcile_failed", { error })), 3_000);
initial.unref();
const timer = setInterval(() => void reconcileQueuedExports().catch((error) => log.error("data_export_reconcile_failed", { error })), 60_000);
timer.unref();

async function close() {
  clearTimeout(initial);
  clearInterval(timer);
  await Promise.allSettled([queue.close(), database.client.end()]);
}
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
