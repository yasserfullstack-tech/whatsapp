import { Worker, type Job } from "bullmq";
import { and, eq, isNull } from "drizzle-orm";
import type { WorkerEnv } from "@wa/config";
import { createDatabase, schema } from "@wa/db";
import { MetaApiError, WhatsAppCloudClient } from "@wa/meta";
import {
  PerNumberRateLimiter,
  SEND_QUEUE_NAME,
  createBullConnection,
  createRedisClient,
  type SendMessageJob,
} from "@wa/queue";
import { claimCampaignRecipientForSend } from "./campaign-security";
import {
  classifyMetaConnectionError,
  markConnectionRequiresReauthorization,
  prepareConnectionForSend,
} from "./connection-health";
import { createAccessTokenLoader, CredentialUnavailableError } from "./campaign-access-token";
import {
  createCampaignSendState,
  errorCode,
  errorText,
} from "./campaign-send-state";

type Database = ReturnType<typeof createDatabase>["db"];
type RedisClient = ReturnType<typeof createRedisClient>;

export function createCampaignSendWorker(input: {
  db: Database;
  redis: RedisClient;
  env: WorkerEnv;
}) {
  const { db, redis, env } = input;
  const limiter = new PerNumberRateLimiter(redis);
  const getAccessToken = createAccessTokenLoader(db, env);
  const { markUnknownSendOutcome, failQueuedRecipientForConnection } = createCampaignSendState(db);

  const guardUnknownPriorOutcome = async (job: Job<SendMessageJob>): Promise<boolean> => {
    const [recipient] = await db
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
      recipient?.status === "queued" &&
      recipient.attemptCount > 0 &&
      recipient.lastError === null &&
      recipient.wamid === null
    ) {
      await markUnknownSendOutcome(
        job.data.recipientId,
        job.data.campaignId,
        job.data.organizationId,
      );
      return true;
    }

    return false;
  };

  const sendWorker = new Worker<SendMessageJob>(
    SEND_QUEUE_NAME,
    async (job: Job<SendMessageJob>) => {
      const mps = Math.min(job.data.maxMessagesPerSecond ?? env.DEFAULT_META_MPS, 1_000);
      await limiter.acquire(job.data.phoneNumberId, Math.max(1, Math.floor(mps * 0.95)));

      const readiness = await prepareConnectionForSend(db, {
        organizationId: job.data.organizationId,
        phoneNumberId: job.data.phoneNumberId,
        credentialKey: job.data.credentialKey,
      });
      if (!readiness.sendable) {
        // Unknown prior provider outcomes still take precedence over a newer
        // connection failure, but successful first-attempt sends avoid this read.
        if (await guardUnknownPriorOutcome(job)) {
          return { failed: true, reason: "send-outcome-unknown" };
        }
        await failQueuedRecipientForConnection(job.data, readiness);
        return { failed: true, reason: "connection-unavailable" };
      }

      let accessToken: string;
      try {
        accessToken = await getAccessToken(job.data.organizationId, job.data.credentialKey);
      } catch (error) {
        if (!(error instanceof CredentialUnavailableError)) throw error;
        if (await guardUnknownPriorOutcome(job)) {
          return { failed: true, reason: "send-outcome-unknown" };
        }
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
        if (await guardUnknownPriorOutcome(job)) {
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

  return sendWorker;
}
