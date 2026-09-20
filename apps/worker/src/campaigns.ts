import { Worker, type Job } from "bullmq";
import { and, count, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
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
  renderTemplateComponents,
  validateTemplateBindings,
  type TemplateParameterBinding,
} from "@wa/meta/templates";
import {
  CAMPAIGN_DISPATCH_QUEUE_NAME,
  PerNumberRateLimiter,
  SEND_QUEUE_NAME,
  createBullConnection,
  createCampaignDispatchQueue,
  createRedisClient,
  createSendQueue,
  type CampaignDispatchJob,
  type SendMessageJob,
} from "@wa/queue";
import { claimCampaignRecipientForSend } from "./campaign-security";
import { claimDueScheduledCampaigns } from "./campaign-scheduling";
import {
  classifyMetaConnectionError,
  markConnectionRequiresReauthorization,
  prepareConnectionForSend,
  startConnectionHealthMonitor,
} from "./connection-health";

type Database = ReturnType<typeof createDatabase>["db"];
type RedisClient = ReturnType<typeof createRedisClient>;

const DISPATCH_BATCH_SIZE = 1_000;
const MAX_CAMPAIGN_BACKLOG = 20_000;
const QUEUE_RUNWAY_SECONDS = 15;
const STALE_QUEUED_MS = 120_000;
const RECONCILE_EVERY_MS = 30_000;
const TOKEN_CACHE_MS = 5 * 60_000;
const UNKNOWN_SEND_OUTCOME_ERROR = "Previous send attempt ended without a recorded Meta outcome; automatic resend suppressed to prevent duplicate delivery";
const UNKNOWN_SEND_OUTCOME_CODE = "send_outcome_unknown";

export type CampaignDeferralResult =
  | { deferred: true; scheduledAt: string | null }
  | { deferred: false };

export function checkCampaignDeferral(campaignStatus: string, scheduledAt: Date | null): CampaignDeferralResult {
  if (campaignStatus === "scheduled") {
    return { deferred: true, scheduledAt: scheduledAt?.toISOString() ?? null };
  }
  return { deferred: false };
}

export type SnapshotResult =
  | { terminal: "failed"; reason: string }
  | { snapshotCreated: true; recipientCount: number; snapshotAt: Date };

export async function createRecipientSnapshot(
  db: Database,
  campaignId: string,
  organizationId: string,
  audienceDefinition: ReturnType<typeof normalizeAudienceDefinition>,
): Promise<SnapshotResult> {
  const audiencePredicate = buildEligibleAudiencePredicate(audienceDefinition, organizationId);

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
      ${organizationId}::uuid,
      ${campaignId}::uuid,
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
    .where(and(
      eq(schema.campaignRecipients.campaignId, campaignId),
      eq(schema.campaignRecipients.organizationId, organizationId),
    ));

  const total = snapshotCount?.total ?? 0;
  if (total === 0) {
    await db
      .update(schema.campaigns)
      .set({ status: "failed", recipientCount: 0, updatedAt: new Date() })
      .where(and(
        eq(schema.campaigns.id, campaignId),
        eq(schema.campaigns.organizationId, organizationId),
      ));
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
    .where(and(
      eq(schema.campaigns.id, campaignId),
      eq(schema.campaigns.organizationId, organizationId),
    ));

  return { snapshotCreated: true, recipientCount: total, snapshotAt };
}

class CredentialUnavailableError extends Error {
  constructor(
    readonly code: "credential_missing" | "credential_unreadable",
    readonly safeReason: string,
  ) {
    super(safeReason);
    this.name = "CredentialUnavailableError";
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeBindings(value: unknown): TemplateParameterBinding[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is TemplateParameterBinding => {
      if (!item || typeof item !== "object") return false;
      const candidate = item as Partial<TemplateParameterBinding>;
      return typeof candidate.index === "number" &&
        (candidate.source === "display_name" || candidate.source === "phone_e164" || candidate.source === "literal");
    })
    .sort((a, b) => a.index - b.index);
}

function richBindingConfigurationError(bindings: TemplateParameterBinding[]): string | null {
  for (const binding of bindings) {
    if (binding.source === "display_name" && !binding.fallback?.trim()) {
      return `${binding.key ?? `Template variable {{${binding.index}}}`} needs an explicit contact-name fallback`;
    }
    if (binding.source === "literal" && !binding.value?.trim()) {
      return `${binding.key ?? `Template variable {{${binding.index}}}`} needs a literal value`;
    }
    if (binding.parameterType === "image" || binding.parameterType === "video" || binding.parameterType === "document") {
      const value = binding.value?.trim();
      if (!value) return `${binding.key ?? "Media header"} needs a media URL`;
      try {
        if (new URL(value).protocol !== "https:") return `${binding.key ?? "Media header"} needs an HTTPS media URL`;
      } catch {
        return `${binding.key ?? "Media header"} needs a valid HTTPS media URL`;
      }
    }
  }
  return null;
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
  const tokenCache = new Map<string, { value: string; expiresAt: number; credentialUpdatedAt: number }>();
  const connectionHealthMonitor = startConnectionHealthMonitor({ db, env });

  const getAccessToken = async (organizationId: string, credentialKey: string): Promise<string> => {
    const cacheKey = `${organizationId}:${credentialKey}`;
    const [secret] = await db
      .select({
        ciphertext: schema.credentialSecrets.ciphertext,
        iv: schema.credentialSecrets.iv,
        authTag: schema.credentialSecrets.authTag,
        updatedAt: schema.credentialSecrets.updatedAt,
      })
      .from(schema.credentialSecrets)
      .where(
        and(
          eq(schema.credentialSecrets.organizationId, organizationId),
          eq(schema.credentialSecrets.key, credentialKey),
        ),
      )
      .limit(1);

    if (!secret) {
      throw new CredentialUnavailableError(
        "credential_missing",
        "The Meta credential is missing. Reconnect WhatsApp to resume sending.",
      );
    }
    const credentialUpdatedAt = secret.updatedAt.getTime();
    const cached = tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() && cached.credentialUpdatedAt === credentialUpdatedAt) return cached.value;

    let value: string;
    try {
      value = decryptSecret(secret, env.CREDENTIAL_ENCRYPTION_KEY);
    } catch {
      throw new CredentialUnavailableError(
        "credential_unreadable",
        "The Meta credential cannot be read. Reconnect WhatsApp to resume sending.",
      );
    }
    tokenCache.set(cacheKey, { value, expiresAt: Date.now() + TOKEN_CACHE_MS, credentialUpdatedAt });
    return value;
  };

  const markUnknownSendOutcome = async (
    recipientId: string,
    campaignId: string,
    organizationId: string,
    detail?: string,
  ) => {
    const failedAt = new Date();
    const suffix = detail?.trim() ? `: ${detail.trim()}` : "";
    const [failed] = await db
      .update(schema.campaignRecipients)
      .set({
        status: "failed",
        lastError: `${UNKNOWN_SEND_OUTCOME_ERROR}${suffix}`.slice(0, 2_000),
        errorCode: UNKNOWN_SEND_OUTCOME_CODE,
        failedAt,
        updatedAt: failedAt,
      })
      .where(
        and(
          eq(schema.campaignRecipients.id, recipientId),
          eq(schema.campaignRecipients.campaignId, campaignId),
          eq(schema.campaignRecipients.organizationId, organizationId),
          eq(schema.campaignRecipients.status, "queued"),
          gt(schema.campaignRecipients.attemptCount, 0),
          isNull(schema.campaignRecipients.lastError),
          isNull(schema.campaignRecipients.wamid),
        ),
      )
      .returning({ id: schema.campaignRecipients.id });
    return Boolean(failed);
  };

  const failQueuedRecipientForConnection = async (
    job: SendMessageJob,
    failure: { code: string; reason: string },
  ) => {
    const failedAt = new Date();
    await db
      .update(schema.campaignRecipients)
      .set({
        status: "failed",
        lastError: failure.reason.slice(0, 2_000),
        errorCode: failure.code,
        failedAt,
        updatedAt: failedAt,
      })
      .where(and(
        eq(schema.campaignRecipients.id, job.recipientId),
        eq(schema.campaignRecipients.campaignId, job.campaignId),
        eq(schema.campaignRecipients.organizationId, job.organizationId),
        eq(schema.campaignRecipients.status, "queued"),
        isNull(schema.campaignRecipients.wamid),
      ));
  };

  const sendWorker = new Worker<SendMessageJob>(
    SEND_QUEUE_NAME,
    async (job: Job<SendMessageJob>) => {
      const mps = Math.min(job.data.maxMessagesPerSecond ?? env.DEFAULT_META_MPS, 1_000);
      await limiter.acquire(job.data.phoneNumberId, Math.max(1, Math.floor(mps * 0.95)));

      // Unknown prior provider outcomes take precedence over connection state.
      // Never replace this safety signal with a newer credential error because
      // doing so could make a real prior send look safe to retry manually.
      const [preflightRecipient] = await db
        .select({
          status: schema.campaignRecipients.status,
          attemptCount: schema.campaignRecipients.attemptCount,
          lastError: schema.campaignRecipients.lastError,
          wamid: schema.campaignRecipients.wamid,
        })
        .from(schema.campaignRecipients)
        .where(and(
          eq(schema.campaignRecipients.id, job.data.recipientId),
          eq(schema.campaignRecipients.campaignId, job.data.campaignId),
          eq(schema.campaignRecipients.organizationId, job.data.organizationId),
        ))
        .limit(1);
      if (
        preflightRecipient?.status === "queued" &&
        preflightRecipient.attemptCount > 0 &&
        preflightRecipient.lastError === null &&
        preflightRecipient.wamid === null
      ) {
        await markUnknownSendOutcome(job.data.recipientId, job.data.campaignId, job.data.organizationId);
        return { failed: true, reason: "send-outcome-unknown" };
      }

      const readiness = await prepareConnectionForSend(db, {
        organizationId: job.data.organizationId,
        phoneNumberId: job.data.phoneNumberId,
        credentialKey: job.data.credentialKey,
      });
      if (!readiness.sendable) {
        await failQueuedRecipientForConnection(job.data, readiness);
        return { failed: true, reason: "connection-unavailable" };
      }

      let accessToken: string;
      try {
        accessToken = await getAccessToken(job.data.organizationId, job.data.credentialKey);
      } catch (error) {
        if (!(error instanceof CredentialUnavailableError)) throw error;
        await markConnectionRequiresReauthorization(db, {
          organizationId: job.data.organizationId,
          phoneNumberId: job.data.phoneNumberId,
          code: error.code,
          reason: error.safeReason,
        });
        await failQueuedRecipientForConnection(job.data, { code: error.code, reason: error.safeReason });
        return { failed: true, reason: "connection-unavailable" };
      }

      const client = new WhatsAppCloudClient({
        accessToken,
        graphApiVersion: env.META_GRAPH_API_VERSION,
      });

      // Claim only after rate limiting and credential lookup, immediately before
      // the provider boundary. A prior claim without a recorded outcome is never
      // automatically resent because that could duplicate a real WhatsApp send.
      const now = new Date();
      const claimed = await claimCampaignRecipientForSend(db, {
        organizationId: job.data.organizationId,
        campaignId: job.data.campaignId,
        recipientId: job.data.recipientId,
        now,
      });

      if (!claimed) {
        const [existing] = await db
          .select({
            status: schema.campaignRecipients.status,
            attemptCount: schema.campaignRecipients.attemptCount,
            lastError: schema.campaignRecipients.lastError,
            wamid: schema.campaignRecipients.wamid,
          })
          .from(schema.campaignRecipients)
          .where(
            and(
              eq(schema.campaignRecipients.id, job.data.recipientId),
              eq(schema.campaignRecipients.campaignId, job.data.campaignId),
              eq(schema.campaignRecipients.organizationId, job.data.organizationId),
            ),
          )
          .limit(1);

        if (
          existing?.status === "queued" &&
          existing.attemptCount > 0 &&
          existing.lastError === null &&
          existing.wamid === null
        ) {
          await markUnknownSendOutcome(
            job.data.recipientId,
            job.data.campaignId,
            job.data.organizationId,
          );
          return { failed: true, reason: "send-outcome-unknown" };
        }

        return { skipped: true, reason: "recipient-already-processed-or-foreign" };
      }

      let result: Awaited<ReturnType<WhatsAppCloudClient["sendTemplate"]>>;
      try {
        result = await client.sendTemplate({
          phoneNumberId: job.data.phoneNumberId,
          to: claimed.phoneE164.replace(/^\+/, ""),
          templateName: job.data.templateName,
          languageCode: job.data.languageCode,
          ...(job.data.components ? { components: job.data.components } : {}),
        });
      } catch (error) {
        if (!(error instanceof MetaApiError)) {
          await markUnknownSendOutcome(
            job.data.recipientId,
            job.data.campaignId,
            job.data.organizationId,
            errorText(error),
          );
          return { failed: true, reason: "send-outcome-unknown" };
        }

        const connectionFailure = classifyMetaConnectionError(error);
        if (connectionFailure.kind === "reauthorize") {
          const failedAt = new Date();
          await markConnectionRequiresReauthorization(db, {
            organizationId: job.data.organizationId,
            phoneNumberId: job.data.phoneNumberId,
            code: connectionFailure.code,
            reason: connectionFailure.reason,
            validatedAt: failedAt,
          });
          await db
            .update(schema.campaignRecipients)
            .set({
              status: "failed",
              lastError: connectionFailure.reason,
              errorCode: connectionFailure.code,
              failedAt,
              updatedAt: failedAt,
            })
            .where(and(
              eq(schema.campaignRecipients.id, job.data.recipientId),
              eq(schema.campaignRecipients.campaignId, job.data.campaignId),
              eq(schema.campaignRecipients.organizationId, job.data.organizationId),
              eq(schema.campaignRecipients.status, "queued"),
              eq(schema.campaignRecipients.attemptCount, claimed.attemptCount),
              isNull(schema.campaignRecipients.wamid),
            ));
          return { failed: true, reason: "connection-reauthorization-required" };
        }

        const attempts = Number(job.opts.attempts ?? 1);
        const isFinalAttempt = job.attemptsMade + 1 >= attempts;
        const failedAt = new Date();
        await db
          .update(schema.campaignRecipients)
          .set({
            status: isFinalAttempt ? "failed" : "queued",
            lastError: errorText(error),
            errorCode: errorCode(error),
            failedAt: isFinalAttempt ? failedAt : null,
            updatedAt: failedAt,
          })
          .where(
            and(
              eq(schema.campaignRecipients.id, job.data.recipientId),
              eq(schema.campaignRecipients.campaignId, job.data.campaignId),
              eq(schema.campaignRecipients.organizationId, job.data.organizationId),
              eq(schema.campaignRecipients.status, "queued"),
              eq(schema.campaignRecipients.attemptCount, claimed.attemptCount),
              isNull(schema.campaignRecipients.lastError),
            ),
          );
        throw error;
      }

      const submittedAt = new Date();
      try {
        const [persisted] = await db
          .update(schema.campaignRecipients)
          .set({
            status: "submitted",
            wamid: result.messageId,
            submittedAt,
            lastError: null,
            errorCode: null,
            updatedAt: submittedAt,
          })
          .where(
            and(
              eq(schema.campaignRecipients.id, job.data.recipientId),
              eq(schema.campaignRecipients.campaignId, job.data.campaignId),
              eq(schema.campaignRecipients.organizationId, job.data.organizationId),
              eq(schema.campaignRecipients.status, "queued"),
              eq(schema.campaignRecipients.attemptCount, claimed.attemptCount),
              isNull(schema.campaignRecipients.lastError),
            ),
          )
          .returning({ id: schema.campaignRecipients.id });

        if (!persisted) return { skipped: true, reason: "recipient-state-changed-after-send" };
        return { wamid: result.messageId };
      } catch (error) {
        await markUnknownSendOutcome(
          job.data.recipientId,
          job.data.campaignId,
          job.data.organizationId,
          `Could not persist Meta success: ${errorText(error)}`,
        );
        return { failed: true, reason: "send-outcome-unknown" };
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
        scheduledAt: schema.campaigns.scheduledAt,
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
        templateComponents: schema.templates.components,
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
    // A forged, stale, or prematurely restored queue job must never bypass the
    // persisted schedule. Reconciliation atomically claims due rows first.
    const deferral = checkCampaignDeferral(record.campaignStatus, record.scheduledAt);
    if (deferral.deferred) return deferral;

    const connection = await prepareConnectionForSend(db, {
      organizationId: record.organizationId,
      phoneNumberId: record.phoneNumberId,
      credentialKey: record.credentialKey,
    });
    if (!connection.sendable || record.phoneStatus !== "connected" || record.templateStatus !== "approved" || record.phoneWabaId !== record.templateWabaId) {
      await db
        .update(schema.campaigns)
        .set({ status: "failed", updatedAt: new Date() })
        .where(and(
          eq(schema.campaigns.id, record.campaignId),
          eq(schema.campaigns.organizationId, record.organizationId),
        ));
      return { terminal: "failed", reason: "phone-or-template-not-sendable" };
    }

    const rawBindings = normalizeBindings(record.templateBindings);
    const validation = validateTemplateBindings(record.templateComponents, rawBindings);
    const bindingError = validation.valid ? richBindingConfigurationError(validation.normalizedBindings) : validation.errors.join("; ");
    if (bindingError) {
      await db
        .update(schema.campaigns)
        .set({ status: "failed", updatedAt: new Date() })
        .where(and(
          eq(schema.campaigns.id, record.campaignId),
          eq(schema.campaigns.organizationId, record.organizationId),
        ));
      return { terminal: "failed", reason: "invalid-template-bindings", error: bindingError };
    }
    const bindings = validation.normalizedBindings;

    if (!record.snapshotCreatedAt) {
      const audienceDefinition = normalizeAudienceDefinition(record.audienceDefinition ?? { type: "all" });
      const snapshotResult = await createRecipientSnapshot(db, record.campaignId, record.organizationId, audienceDefinition);
      if ("terminal" in snapshotResult) return snapshotResult;
    }

    const targetBacklog = Math.max(
      DISPATCH_BATCH_SIZE,
      Math.min(MAX_CAMPAIGN_BACKLOG, Math.max(1, record.throughputMps) * QUEUE_RUNWAY_SECONDS),
    );

    for (;;) {
      const [campaignState] = await db
        .select({ status: schema.campaigns.status })
        .from(schema.campaigns)
        .where(and(
          eq(schema.campaigns.id, record.campaignId),
          eq(schema.campaigns.organizationId, record.organizationId),
        ))
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
            eq(schema.campaignRecipients.organizationId, record.organizationId),
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
            eq(schema.campaignRecipients.organizationId, record.organizationId),
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
            .where(and(
              eq(schema.campaigns.id, record.campaignId),
              eq(schema.campaigns.organizationId, record.organizationId),
            ));
          return { terminal: "completed" };
        }

        await db
          .update(schema.campaigns)
          .set({ dispatchCompletedAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(schema.campaigns.id, record.campaignId),
              eq(schema.campaigns.organizationId, record.organizationId),
              isNull(schema.campaigns.dispatchCompletedAt),
            ),
          );
        await sleep(250);
        continue;
      }

      // Reserve in PostgreSQL before publishing to BullMQ. This prevents a fast
      // send worker from completing Meta before durable recipient state is queued
      // and makes concurrent dispatch jobs race safely.
      const ids = recipients.map((recipient) => recipient.id);
      const queuedAt = new Date();
      const claimedRows = await db
        .update(schema.campaignRecipients)
        .set({ status: "queued", queuedAt, updatedAt: queuedAt })
        .where(
          and(
            inArray(schema.campaignRecipients.id, ids),
            eq(schema.campaignRecipients.organizationId, record.organizationId),
            eq(schema.campaignRecipients.status, "pending"),
          ),
        )
        .returning({ id: schema.campaignRecipients.id });

      if (!claimedRows.length) continue;
      const claimedIds = new Set(claimedRows.map((recipient) => recipient.id));
      const claimedRecipients = recipients.filter((recipient) => claimedIds.has(recipient.id));
      const jobs = claimedRecipients.map((recipient) => ({
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
          components: renderTemplateComponents(record.templateComponents, bindings, recipient) as TemplateComponent[] | undefined,
          maxMessagesPerSecond: record.throughputMps,
        } satisfies SendMessageJob,
        opts: { jobId: `send-${recipient.id}` },
      }));

      await sendQueue.addBulk(jobs);

      await db
        .update(schema.campaigns)
        .set({ status: "sending", updatedAt: queuedAt })
        .where(and(
          eq(schema.campaigns.id, record.campaignId),
          eq(schema.campaigns.organizationId, record.organizationId),
        ));
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
    const reconciliationAt = new Date();

    // PostgreSQL owns schedules. The conditional scheduled -> dispatching claim
    // is safe across concurrent worker processes; the normal dispatcher queue is
    // then reconstructed from DB state just like any other active campaign.
    await claimDueScheduledCampaigns(db, reconciliationAt);

    await db
      .update(schema.campaignRecipients)
      .set({
        status: "failed",
        lastError: UNKNOWN_SEND_OUTCOME_ERROR,
        errorCode: UNKNOWN_SEND_OUTCOME_CODE,
        failedAt: reconciliationAt,
        updatedAt: reconciliationAt,
      })
      .where(
        and(
          eq(schema.campaignRecipients.status, "queued"),
          gt(schema.campaignRecipients.attemptCount, 0),
          lt(schema.campaignRecipients.lastAttemptAt, staleBefore),
          isNull(schema.campaignRecipients.lastError),
          isNull(schema.campaignRecipients.wamid),
        ),
      );

    await db
      .update(schema.campaignRecipients)
      .set({
        status: "pending",
        queuedAt: null,
        lastError: "Recovered a stale queue reservation",
        updatedAt: reconciliationAt,
      })
      .where(
        and(
          eq(schema.campaignRecipients.status, "queued"),
          lt(schema.campaignRecipients.queuedAt, staleBefore),
          isNull(schema.campaignRecipients.wamid),
          or(
            eq(schema.campaignRecipients.attemptCount, 0),
            isNotNull(schema.campaignRecipients.lastError),
          ),
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
      connectionHealthMonitor.close();
      await Promise.all([
        sendWorker.close(true),
        campaignDispatchWorker.close(true),
        sendQueue.close(),
        dispatchQueue.close(),
      ]);
    },
  };
}
