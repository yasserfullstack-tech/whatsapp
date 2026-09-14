import { Worker, type Job } from "bullmq";
import { and, count, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { decryptSecret } from "@wa/credentials";
import type { WorkerEnv } from "@wa/config";
import {
  buildEligibleAudiencePredicate,
  createDatabase,
  normalizeAudienceDefinition,
  schema,
} from "@wa/db";
import { MetaApiError, WhatsAppCloudClient, type TemplateComponent } from "@wa/meta";
import {
  CAMPAIGN_DISPATCH_QUEUE_NAME,
  PerNumberRateLimiter,
  SEND_QUEUE_NAME,
  createBullConnection,
  createCampaignDispatchQueue,
  createRedisClient,
  createSendQueue,
  type CampaignDispatchJob,
  type CampaignVariableBinding,
  type SendMessageJob,
} from "@wa/queue";
import { claimCampaignRecipientForSend } from "./campaign-security";

type Database = ReturnType<typeof createDatabase>["db"];
type RedisClient = ReturnType<typeof createRedisClient>;

const DISPATCH_BATCH_SIZE = 1_000;
const MAX_CAMPAIGN_BACKLOG = 20_000;
const QUEUE_RUNWAY_SECONDS = 15;
const STALE_QUEUED_MS = 120_000;
const RECONCILE_EVERY_MS = 30_000;
const TOKEN_CACHE_MS = 5 * 60_000;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeBindings(value: unknown): CampaignVariableBinding[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is CampaignVariableBinding => {
      if (!item || typeof item !== "object") return false;
      const candidate = item as Partial<CampaignVariableBinding>;
      return typeof candidate.index === "number" &&
        (candidate.source === "display_name" || candidate.source === "phone_e164" || candidate.source === "literal");
    })
    .sort((a, b) => a.index - b.index);
}

function bindingConfigurationError(bindings: CampaignVariableBinding[]): string | null {
  for (const binding of bindings) {
    if (binding.source === "display_name" && !binding.fallback?.trim()) {
      return `Template variable {{${binding.index}}} needs an explicit contact-name fallback`;
    }
    if (binding.source === "literal" && !binding.value?.trim()) {
      return `Template variable {{${binding.index}}} needs a literal value`;
    }
  }
  return null;
}

function resolveComponents(
  bindings: CampaignVariableBinding[],
  recipient: { displayName: string | null; phoneE164: string },
): TemplateComponent[] | undefined {
  if (!bindings.length) return undefined;

  const parameters = bindings.map((binding) => {
    let text: string;
    if (binding.source === "display_name") {
      const displayName = recipient.displayName?.trim();
      const fallback = binding.fallback?.trim();
      if (!displayName && !fallback) throw new Error(`Template variable {{${binding.index}}} has no contact-name value`);
      text = displayName || fallback!;
    } else if (binding.source === "phone_e164") {
      text = recipient.phoneE164;
    } else {
      const value = binding.value?.trim();
      if (!value) throw new Error(`Template variable {{${binding.index}}} has no literal value`);
      text = value;
    }
    return { type: "text" as const, text };
  });

  return [{ type: "body", parameters }];
}

function errorText(error: unknown): string {
  if (error instanceof MetaApiError) {
    let body = "";
    try {
      body = JSON.stringify(error.responseBody);
    } catch {
      body = "";
    }
    return `${error.message} (${error.status})${body ? ` ${body}` : ""}`.slice(0, 2_000);
  }
  return (error instanceof Error ? error.message : "Unknown send error").slice(0, 2_000);
}

function errorCode(error: unknown): string | null {
  if (!(error instanceof MetaApiError) || !error.responseBody || typeof error.responseBody !== "object") return null;
  const outer = error.responseBody as Record<string, unknown>;
  if (!outer.error || typeof outer.error !== "object") return String(error.status);
  const metaError = outer.error as Record<string, unknown>;
  return typeof metaError.code === "number" || typeof metaError.code === "string"
    ? String(metaError.code)
    : String(error.status);
}

export function startCampaignWorkers(input: {
  db: Database;
  redis: RedisClient;
  env: WorkerEnv;
}) {
  const { db, redis, env } = input;
  const limiter = new PerNumberRateLimiter(redis);
  const sendQueue = createSendQueue(env.REDIS_URL);
  const dispatchQueue = createCampaignDispatchQueue(env.REDIS_URL);
  const tokenCache = new Map<string, { value: string; expiresAt: number }>();

  const getAccessToken = async (organizationId: string, credentialKey: string): Promise<string> => {
    const cacheKey = `${organizationId}:${credentialKey}`;
    const cached = tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const [secret] = await db
      .select({
        ciphertext: schema.credentialSecrets.ciphertext,
        iv: schema.credentialSecrets.iv,
        authTag: schema.credentialSecrets.authTag,
      })
      .from(schema.credentialSecrets)
      .where(
        and(
          eq(schema.credentialSecrets.organizationId, organizationId),
          eq(schema.credentialSecrets.key, credentialKey),
        ),
      )
      .limit(1);

    if (!secret) throw new Error(`Credential ${credentialKey} was not found for this organization`);
    const value = decryptSecret(secret, env.CREDENTIAL_ENCRYPTION_KEY);
    tokenCache.set(cacheKey, { value, expiresAt: Date.now() + TOKEN_CACHE_MS });
    return value;
  };

  const sendWorker = new Worker<SendMessageJob>(
    SEND_QUEUE_NAME,
    async (job: Job<SendMessageJob>) => {
      const now = new Date();
      const claimed = await claimCampaignRecipientForSend(db, {
        organizationId: job.data.organizationId,
        campaignId: job.data.campaignId,
        recipientId: job.data.recipientId,
        now,
      });

      if (!claimed) return { skipped: true, reason: "recipient-already-processed-or-foreign" };

      const mps = Math.min(job.data.maxMessagesPerSecond ?? env.DEFAULT_META_MPS, 1_000);
      await limiter.acquire(job.data.phoneNumberId, Math.max(1, Math.floor(mps * 0.95)));

      try {
        const accessToken = await getAccessToken(job.data.organizationId, job.data.credentialKey);
        const client = new WhatsAppCloudClient({
          accessToken,
          graphApiVersion: env.META_GRAPH_API_VERSION,
        });

        const result = await client.sendTemplate({
          phoneNumberId: job.data.phoneNumberId,
          to: claimed.phoneE164.replace(/^\+/, ""),
          templateName: job.data.templateName,
          languageCode: job.data.languageCode,
          ...(job.data.components ? { components: job.data.components } : {}),
        });

        const submittedAt = new Date();
        await db
          .update(schema.campaignRecipients)
          .set({
            status: "submitted",
            wamid: result.messageId,
            submittedAt,
            lastError: null,
            errorCode: null,
            updatedAt: submittedAt,
          })
          .where(and(
            eq(schema.campaignRecipients.id, job.data.recipientId),
            eq(schema.campaignRecipients.campaignId, job.data.campaignId),
            eq(schema.campaignRecipients.organizationId, job.data.organizationId),
          ));

        return { wamid: result.messageId };
      } catch (error) {
        const attempts = Number(job.opts.attempts ?? 1);
        const isFinalAttempt = job.attemptsMade + 1 >= attempts;
        const failedAt = new Date();
        await db
          .update(schema.campaignRecipients)
          .set({
            status: isFinalAttempt ? "failed" : "queued",
            lastError: errorText(error),
            errorCode: errorCode(error),
            ...(isFinalAttempt ? { failedAt } : {}),
            updatedAt: failedAt,
          })
          .where(and(
            eq(schema.campaignRecipients.id, job.data.recipientId),
            eq(schema.campaignRecipients.campaignId, job.data.campaignId),
            eq(schema.campaignRecipients.organizationId, job.data.organizationId),
          ));
        throw error;
      }
    },
    {
      connection: createBullConnection(env.REDIS_URL),
      concurrency: env.WORKER_CONCURRENCY,
    },
  );

  const dispatchCampaign = async (job: CampaignDispatchJob) => {
    const [record] = await db
      .select({
        campaignId: schema.campaigns.id,
        organizationId: schema.campaigns.organizationId,
        campaignStatus: schema.campaigns.status,
        snapshotCreatedAt: schema.campaigns.snapshotCreatedAt,
        templateBindings: schema.campaigns.templateBindings,
        audienceDefinition: schema.campaignAudiences.definition,
        phoneNumberId: schema.whatsappPhoneNumbers.phoneNumberId,
        phoneStatus: schema.whatsappPhoneNumbers.status,
        throughputMps: schema.whatsappPhoneNumbers.throughputMps,
        credentialKey: schema.whatsappPhoneNumbers.credentialKey,
        phoneWabaId: schema.whatsappPhoneNumbers.wabaId,
        templateName: schema.templates.name,
        templateLanguage: schema.templates.language,
        templateStatus: schema.templates.status,
        templateWabaId: schema.templates.wabaId,
      })
      .from(schema.campaigns)
      .innerJoin(
        schema.whatsappPhoneNumbers,
        eq(schema.campaigns.whatsappPhoneNumberId, schema.whatsappPhoneNumbers.id),
      )
      .innerJoin(schema.templates, eq(schema.campaigns.templateId, schema.templates.id))
      .leftJoin(schema.campaignAudiences, eq(schema.campaignAudiences.campaignId, schema.campaigns.id))
      .where(
        and(
          eq(schema.campaigns.id, job.campaignId),
          eq(schema.campaigns.organizationId, job.organizationId),
        ),
      )
      .limit(1);

    if (!record) throw new Error(`Campaign ${job.campaignId} was not found`);
    if (["completed", "cancelled", "failed"].includes(record.campaignStatus)) return { terminal: record.campaignStatus };

    if (record.phoneStatus !== "connected" || record.templateStatus !== "approved" || record.phoneWabaId !== record.templateWabaId) {
      await db
        .update(schema.campaigns)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(schema.campaigns.id, record.campaignId));
      return { terminal: "failed", reason: "phone-or-template-not-sendable" };
    }

    const bindings = normalizeBindings(record.templateBindings);
    const bindingError = bindingConfigurationError(bindings);
    if (bindingError) {
      await db
        .update(schema.campaigns)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(schema.campaigns.id, record.campaignId));
      return { terminal: "failed", reason: "invalid-template-bindings", error: bindingError };
    }

    if (!record.snapshotCreatedAt) {
      const audienceDefinition = normalizeAudienceDefinition(record.audienceDefinition ?? { type: "all" });
      const audiencePredicate = buildEligibleAudiencePredicate(audienceDefinition, record.organizationId);

      await db.execute(sql`
        INSERT INTO campaign_recipients (
          id,
          organization_id,
          campaign_id,
          contact_id,
          phone_e164,
          display_name,
          status,
          created_at,
          updated_at
        )
        SELECT
          gen_random_uuid(),
          ${record.organizationId}::uuid,
          ${record.campaignId}::uuid,
          c.id,
          c.phone_e164,
          c.display_name,
          'pending',
          now(),
          now()
        FROM contacts c
        WHERE ${audiencePredicate}
        ON CONFLICT (campaign_id, contact_id) DO NOTHING
      `);

      const [snapshotCount] = await db
        .select({ total: count() })
        .from(schema.campaignRecipients)
        .where(eq(schema.campaignRecipients.campaignId, record.campaignId));

      const total = snapshotCount?.total ?? 0;
      if (total === 0) {
        await db
          .update(schema.campaigns)
          .set({ status: "failed", recipientCount: 0, updatedAt: new Date() })
          .where(eq(schema.campaigns.id, record.campaignId));
        return { terminal: "failed", reason: "no-eligible-recipients" };
      }

      const snapshotAt = new Date();
      await db
        .update(schema.campaigns)
        .set({
          recipientCount: total,
          snapshotCreatedAt: snapshotAt,
          startedAt: snapshotAt,
          status: "sending",
          updatedAt: snapshotAt,
        })
        .where(eq(schema.campaigns.id, record.campaignId));
    }

    const targetBacklog = Math.max(
      DISPATCH_BATCH_SIZE,
      Math.min(MAX_CAMPAIGN_BACKLOG, Math.max(1, record.throughputMps) * QUEUE_RUNWAY_SECONDS),
    );

    for (;;) {
      const [campaignState] = await db
        .select({ status: schema.campaigns.status })
        .from(schema.campaigns)
        .where(eq(schema.campaigns.id, record.campaignId))
        .limit(1);

      if (!campaignState || ["cancelled", "failed", "completed"].includes(campaignState.status)) {
        return { terminal: campaignState?.status ?? "missing" };
      }
      if (campaignState.status === "paused") {
        await sleep(1_000);
        continue;
      }

      const [queuedRow] = await db
        .select({ total: count() })
        .from(schema.campaignRecipients)
        .where(
          and(
            eq(schema.campaignRecipients.campaignId, record.campaignId),
            eq(schema.campaignRecipients.status, "queued"),
          ),
        );
      const queuedCount = queuedRow?.total ?? 0;

      if (queuedCount >= targetBacklog) {
        await sleep(250);
        continue;
      }

      const batchLimit = Math.min(DISPATCH_BATCH_SIZE, targetBacklog - queuedCount);
      const recipients = await db
        .select({
          id: schema.campaignRecipients.id,
          phoneE164: schema.campaignRecipients.phoneE164,
          displayName: schema.campaignRecipients.displayName,
        })
        .from(schema.campaignRecipients)
        .where(
          and(
            eq(schema.campaignRecipients.campaignId, record.campaignId),
            eq(schema.campaignRecipients.status, "pending"),
          ),
        )
        .orderBy(schema.campaignRecipients.id)
        .limit(batchLimit);

      if (!recipients.length) {
        if (queuedCount === 0) {
          const completedAt = new Date();
          await db
            .update(schema.campaigns)
            .set({
              status: "completed",
              dispatchCompletedAt: completedAt,
              completedAt,
              updatedAt: completedAt,
            })
            .where(eq(schema.campaigns.id, record.campaignId));
          return { terminal: "completed" };
        }

        await db
          .update(schema.campaigns)
          .set({ dispatchCompletedAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(schema.campaigns.id, record.campaignId),
              isNull(schema.campaigns.dispatchCompletedAt),
            ),
          );
        await sleep(250);
        continue;
      }

      const jobs = recipients.map((recipient) => ({
        name: "send-template",
        data: {
          organizationId: record.organizationId,
          campaignId: record.campaignId,
          recipientId: recipient.id,
          phoneNumberId: record.phoneNumberId,
          credentialKey: record.credentialKey,
          to: recipient.phoneE164.replace(/^\+/, ""),
          templateName: record.templateName,
          languageCode: record.templateLanguage,
          components: resolveComponents(bindings, recipient),
          maxMessagesPerSecond: record.throughputMps,
        } satisfies SendMessageJob,
        opts: { jobId: `send-${recipient.id}` },
      }));

      await sendQueue.addBulk(jobs);
      const ids = recipients.map((recipient) => recipient.id);
      const queuedAt = new Date();
      await db
        .update(schema.campaignRecipients)
        .set({ status: "queued", queuedAt, updatedAt: queuedAt })
        .where(
          and(
            inArray(schema.campaignRecipients.id, ids),
            eq(schema.campaignRecipients.status, "pending"),
          ),
        );

      await db
        .update(schema.campaigns)
        .set({ status: "sending", updatedAt: queuedAt })
        .where(eq(schema.campaigns.id, record.campaignId));
    }
  };

  const campaignDispatchWorker = new Worker<CampaignDispatchJob>(
    CAMPAIGN_DISPATCH_QUEUE_NAME,
    async (job) => dispatchCampaign(job.data),
    {
      connection: createBullConnection(env.REDIS_URL),
      concurrency: env.CAMPAIGN_DISPATCH_CONCURRENCY,
    },
  );

  const reconcile = async () => {
    const staleBefore = new Date(Date.now() - STALE_QUEUED_MS);
    await db
      .update(schema.campaignRecipients)
      .set({
        status: "pending",
        queuedAt: null,
        lastError: "Recovered a stale queue reservation",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.campaignRecipients.status, "queued"),
          lt(schema.campaignRecipients.queuedAt, staleBefore),
          isNull(schema.campaignRecipients.wamid),
        ),
      );

    const activeCampaigns = await db
      .select({
        id: schema.campaigns.id,
        organizationId: schema.campaigns.organizationId,
      })
      .from(schema.campaigns)
      .where(inArray(schema.campaigns.status, ["dispatching", "sending"]));

    for (const campaign of activeCampaigns) {
      await dispatchQueue.add(
        "dispatch-campaign",
        { organizationId: campaign.organizationId, campaignId: campaign.id },
        { jobId: `campaign-${campaign.id}` },
      );
    }
  };

  void reconcile().catch((error) => console.error("Campaign reconciliation failed", error));
  const reconciliationTimer = setInterval(() => {
    void reconcile().catch((error) => console.error("Campaign reconciliation failed", error));
  }, RECONCILE_EVERY_MS);
  reconciliationTimer.unref();

  return {
    sendWorker,
    campaignDispatchWorker,
    async close() {
      clearInterval(reconciliationTimer);
      await Promise.all([
        sendWorker.close(true),
        campaignDispatchWorker.close(true),
        sendQueue.close(),
        dispatchQueue.close(),
      ]);
    },
  };
}
