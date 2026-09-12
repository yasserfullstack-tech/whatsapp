import { Worker } from "bullmq";
import { and, eq } from "drizzle-orm";
import { parse } from "csv-parse";
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";
import { loadWorkerEnv } from "@wa/config";
import { createDatabase, schema } from "@wa/db";
import { WhatsAppCloudClient } from "@wa/meta";
import {
  CONTACT_IMPORT_QUEUE_NAME,
  PerNumberRateLimiter,
  SEND_QUEUE_NAME,
  WEBHOOK_QUEUE_NAME,
  createBullConnection,
  createRedisClient,
  type ContactImportJob,
  type SendMessageJob,
} from "@wa/queue";
import { createR2Client, getStoredObject } from "@wa/storage";

const env = loadWorkerEnv();
const redis = createRedisClient(env.REDIS_URL);
const limiter = new PerNumberRateLimiter(redis);
const database = createDatabase(env.DATABASE_URL);
const db = database.db;
const r2 = createR2Client({
  accountId: env.R2_ACCOUNT_ID,
  accessKeyId: env.R2_ACCESS_KEY_ID,
  secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  bucket: env.R2_BUCKET,
});

await redis.connect();

const sendWorker = new Worker<SendMessageJob>(
  SEND_QUEUE_NAME,
  async (job) => {
    const mps = Math.min(job.data.maxMessagesPerSecond ?? env.DEFAULT_META_MPS, 1_000);
    await limiter.acquire(job.data.phoneNumberId, Math.max(1, Math.floor(mps * 0.95)));

    if (!env.META_ACCESS_TOKEN) {
      throw new Error("META_ACCESS_TOKEN is not configured. Use a per-client secret provider in production.");
    }

    const client = new WhatsAppCloudClient({
      accessToken: env.META_ACCESS_TOKEN,
      graphApiVersion: env.META_GRAPH_API_VERSION,
    });

    return client.sendTemplate({
      phoneNumberId: job.data.phoneNumberId,
      to: job.data.to,
      templateName: job.data.templateName,
      languageCode: job.data.languageCode,
      ...(job.data.components ? { components: job.data.components } : {}),
    });
  },
  {
    connection: createBullConnection(env.REDIS_URL),
    concurrency: env.WORKER_CONCURRENCY,
  },
);

const webhookWorker = new Worker(
  WEBHOOK_QUEUE_NAME,
  async (job) => {
    // Persist raw webhook payloads and apply status transitions in the next milestone.
    console.log("Received Meta webhook", { jobId: job.id });
  },
  {
    connection: createBullConnection(env.REDIS_URL),
    concurrency: 100,
  },
);

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

sendWorker.on("failed", (job, error) => {
  console.error("Send job failed", { jobId: job?.id, message: error.message });
});

webhookWorker.on("failed", (job, error) => {
  console.error("Webhook job failed", { jobId: job?.id, message: error.message });
});

contactImportWorker.on("failed", (job, error) => {
  console.error("Contact import failed", { jobId: job?.id, message: error.message });
});

console.log("Workers started", {
  sendConcurrency: env.WORKER_CONCURRENCY,
  contactImportConcurrency: env.CONTACT_IMPORT_CONCURRENCY,
  defaultMps: env.DEFAULT_META_MPS,
});

const shutdown = async () => {
  await Promise.all([sendWorker.close(), webhookWorker.close(), contactImportWorker.close()]);
  await redis.quit();
  await database.client.end();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
