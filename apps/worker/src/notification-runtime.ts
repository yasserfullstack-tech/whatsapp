import { QueueEvents, Worker, type Job } from "bullmq";
import { eq } from "drizzle-orm";
import { loadWorkerEnv } from "@wa/config";
import { createDatabase, schema } from "@wa/db";
import {
  ConsoleEmailProvider,
  NotificationService,
  deliverNotificationEmail,
  getPendingEmailDeliveryIds,
  type EmailProvider,
} from "@wa/notifications";
import { createLogger } from "@wa/observability";
import {
  CAMPAIGN_DISPATCH_QUEUE_NAME,
  CONTACT_IMPORT_QUEUE_NAME,
  NOTIFICATION_EMAIL_QUEUE_NAME,
  createBullConnection,
  createContactImportQueue,
  createNotificationEmailQueue,
  type NotificationEmailJob,
} from "@wa/queue";
import { reconcileNotificationSources } from "./notification-sources";

class ResendEmailProvider implements EmailProvider {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(input: Parameters<EmailProvider["send"]>[0]): Promise<{ messageId?: string }> {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify({
        from: this.from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });

    const body = await response.json().catch(() => null) as { id?: unknown } | null;
    if (!response.ok) {
      throw new Error(`Notification email provider rejected the request (${response.status})`);
    }
    return typeof body?.id === "string" ? { messageId: body.id } : {};
  }
}

function requiredProductionValue(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required in production`);
  return value;
}

const env = loadWorkerEnv();
const database = createDatabase(env.DATABASE_URL);
const db = database.db;
const log = createLogger({ service: "notification-worker" });
const emailQueue = createNotificationEmailQueue(env.REDIS_URL);
const contactImportQueue = createContactImportQueue(env.REDIS_URL);
const provider: EmailProvider = env.NODE_ENV === "production"
  ? new ResendEmailProvider(
      requiredProductionValue("RESEND_API_KEY", env.RESEND_API_KEY),
      requiredProductionValue("AUTH_EMAIL_FROM", env.AUTH_EMAIL_FROM),
    )
  : new ConsoleEmailProvider();
const providerName = env.NODE_ENV === "production" ? "resend" : "console";
const appUrl = env.NODE_ENV === "production"
  ? requiredProductionValue("APP_URL", env.APP_URL)
  : env.APP_URL ?? "http://127.0.0.1:3000";

const notificationService = new NotificationService({
  db,
  enqueueEmailDelivery: async (deliveryId) => {
    await emailQueue.add(
      "deliver-notification-email",
      { deliveryId },
      { jobId: `notification-email-${deliveryId}` },
    );
  },
  onEnqueueError: (error, deliveryId) => {
    log.warn("notification_email_enqueue_failed", { deliveryId, error });
  },
});

const emailWorker = new Worker<NotificationEmailJob>(
  NOTIFICATION_EMAIL_QUEUE_NAME,
  async (job: Job<NotificationEmailJob>) => {
    const attempts = Number(job.opts.attempts ?? 1);
    const finalAttempt = job.attemptsMade + 1 >= attempts;
    return deliverNotificationEmail({
      db,
      deliveryId: job.data.deliveryId,
      provider,
      finalAttempt,
      baseUrl: appUrl,
    });
  },
  {
    connection: createBullConnection(env.REDIS_URL),
    concurrency: 8,
  },
);

emailWorker.on("failed", (job, error) => {
  log.error("notification_email_delivery_failed", {
    jobId: job?.id,
    deliveryId: job?.data.deliveryId,
    attempt: job ? job.attemptsMade : undefined,
    error,
  });
});

async function emitCampaignTerminal(campaignId: string) {
  const campaign = (
    await db
      .select({
        id: schema.campaigns.id,
        organizationId: schema.campaigns.organizationId,
        name: schema.campaigns.name,
        status: schema.campaigns.status,
      })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1)
  )[0];
  if (!campaign || (campaign.status !== "completed" && campaign.status !== "failed")) return;

  await notificationService.emit({
    id: `campaign:${campaign.id}:${campaign.status}`,
    type: campaign.status === "completed" ? "campaign_completed" : "campaign_failed",
    organizationId: campaign.organizationId,
    metadata: { campaignId: campaign.id, campaignName: campaign.name },
    link: `/campaigns/${campaign.id}`,
  });
}

async function emitImportTerminal(importId: string) {
  const contactImport = (
    await db
      .select({
        id: schema.contactImports.id,
        organizationId: schema.contactImports.organizationId,
        fileName: schema.contactImports.originalFileName,
        status: schema.contactImports.status,
        importedRows: schema.contactImports.importedRows,
        invalidRows: schema.contactImports.invalidRows,
        errorMessage: schema.contactImports.errorMessage,
      })
      .from(schema.contactImports)
      .where(eq(schema.contactImports.id, importId))
      .limit(1)
  )[0];
  if (!contactImport || (contactImport.status !== "completed" && contactImport.status !== "failed")) return;

  await notificationService.emit({
    id: `import:${contactImport.id}:${contactImport.status}`,
    type: contactImport.status === "completed" ? "import_completed" : "import_failed",
    organizationId: contactImport.organizationId,
    metadata: {
      importId: contactImport.id,
      fileName: contactImport.fileName,
      importedRows: contactImport.importedRows,
      invalidRows: contactImport.invalidRows,
      ...(contactImport.errorMessage ? { detail: contactImport.errorMessage } : {}),
    },
    link: "/contacts",
  });
}

function idFromJob(jobId: string, prefix: string): string | null {
  return jobId.startsWith(prefix) ? jobId.slice(prefix.length) : null;
}

function reportAsync(name: string, operation: Promise<unknown>, context: Record<string, unknown>) {
  void operation.catch((error) => log.error(name, { ...context, error }));
}

const campaignEvents = new QueueEvents(CAMPAIGN_DISPATCH_QUEUE_NAME, {
  connection: createBullConnection(env.REDIS_URL),
});
const importEvents = new QueueEvents(CONTACT_IMPORT_QUEUE_NAME, {
  connection: createBullConnection(env.REDIS_URL),
});

campaignEvents.on("completed", ({ jobId }) => {
  const campaignId = idFromJob(jobId, "campaign-");
  if (campaignId) reportAsync("campaign_notification_failed", emitCampaignTerminal(campaignId), { campaignId });
});
campaignEvents.on("failed", ({ jobId }) => {
  const campaignId = idFromJob(jobId, "campaign-");
  if (campaignId) reportAsync("campaign_notification_failed", emitCampaignTerminal(campaignId), { campaignId });
});

importEvents.on("completed", ({ jobId }) => {
  const importId = idFromJob(jobId, "contact-import-");
  if (importId) reportAsync("import_notification_failed", emitImportTerminal(importId), { importId });
});
importEvents.on("failed", ({ jobId }) => {
  const importId = idFromJob(jobId, "contact-import-");
  if (!importId) return;
  reportAsync("import_failure_notification_failed", (async () => {
    const job = await contactImportQueue.getJob(jobId);
    if (!job) return;
    const attempts = Number(job.opts.attempts ?? 1);
    if (job.attemptsMade < attempts) return;
    await emitImportTerminal(importId);
  })(), { importId });
});

async function reconcilePendingEmailDeliveries() {
  const deliveryIds = await getPendingEmailDeliveryIds(db, 1_000);
  if (!deliveryIds.length) return;
  await emailQueue.addBulk(deliveryIds.map((deliveryId) => ({
    name: "deliver-notification-email",
    data: { deliveryId },
    opts: { jobId: `notification-email-${deliveryId}` },
  })));
  log.info("notification_email_reconciled", { count: deliveryIds.length });
}

const SOURCE_REPLAY_OVERLAP_MS = 2 * 60_000;
let sourceScanAnchor = new Date();
async function reconcileDurableSources() {
  const scanStartedAt = new Date();
  const since = new Date(sourceScanAnchor.getTime() - SOURCE_REPLAY_OVERLAP_MS);
  const result = await reconcileNotificationSources({ db, notifications: notificationService, since });
  sourceScanAnchor = scanStartedAt;
  const created = Object.values(result).reduce((sum, count) => sum + count, 0);
  if (created > 0) log.info("notification_sources_reconciled", { created, ...result });
}

await Promise.all([campaignEvents.waitUntilReady(), importEvents.waitUntilReady()]);
await reconcilePendingEmailDeliveries().catch((error) => log.warn("notification_email_reconcile_failed", { error }));
await reconcileDurableSources().catch((error) => log.warn("notification_source_reconcile_failed", { error }));

const reconciliationTimer = setInterval(() => {
  reportAsync("notification_email_reconcile_failed", reconcilePendingEmailDeliveries(), {});
}, 60_000);
reconciliationTimer.unref();

const sourceReconciliationTimer = setInterval(() => {
  reportAsync("notification_source_reconcile_failed", reconcileDurableSources(), {});
}, 30_000);
sourceReconciliationTimer.unref();

log.info("notification_runtime_started", {
  emailProvider: providerName,
  emailConcurrency: 8,
  sourceReplayOverlapSeconds: SOURCE_REPLAY_OVERLAP_MS / 1_000,
});

const shutdown = async () => {
  clearInterval(reconciliationTimer);
  clearInterval(sourceReconciliationTimer);
  await Promise.all([
    emailWorker.close(true),
    campaignEvents.close(),
    importEvents.close(),
    emailQueue.close(),
    contactImportQueue.close(),
  ]);
  await database.client.end();
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
