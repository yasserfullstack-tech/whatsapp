import { Worker } from "bullmq";
import { EntitlementService } from "@wa/billing";
import type { WorkerEnv } from "@wa/config";
import { createDatabase } from "@wa/db";
import {
  CONTACT_IMPORT_QUEUE_NAME,
  createBullConnection,
  type ContactImportJob,
} from "@wa/queue";
import { createR2Client } from "@wa/storage";
import { createContactImportProcessor } from "./contact-import-processor";

type Database = ReturnType<typeof createDatabase>;
type R2Client = ReturnType<typeof createR2Client>;

export function createContactImportWorker(input: {
  database: Database;
  entitlements: EntitlementService;
  r2: R2Client;
  env: WorkerEnv;
}) {
  const { env } = input;
  const processContactImport = createContactImportProcessor(input);

  return new Worker<ContactImportJob>(
    CONTACT_IMPORT_QUEUE_NAME,
    async (job) => processContactImport(job.data),
    {
      connection: createBullConnection(env.REDIS_URL),
      concurrency: env.CONTACT_IMPORT_CONCURRENCY,
    },
  );
}
