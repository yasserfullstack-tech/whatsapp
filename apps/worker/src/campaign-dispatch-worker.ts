import { Worker } from "bullmq";
import { and, count, eq, inArray, isNull } from "drizzle-orm";
import type { EntitlementService } from "@wa/billing";
import type { WorkerEnv } from "@wa/config";
import { createDatabase, normalizeAudienceDefinition, schema } from "@wa/db";
import type { TemplateComponent } from "@wa/meta";
import {
  renderTemplateComponents,
  validateTemplateBindings,
} from "@wa/meta/templates";
import {
  CAMPAIGN_DISPATCH_QUEUE_NAME,
  createBullConnection,
  createSendQueue,
  type CampaignDispatchJob,
  type SendMessageJob,
} from "@wa/queue";
import { reserveCampaignRecipientUsage } from "./campaign-billing";
import { prepareConnectionForSend } from "./connection-health";
import { checkCampaignDeferral, createRecipientSnapshot } from "./campaign-snapshot";
import {
  normalizeBindings,
  richBindingConfigurationError,
} from "./campaign-template-bindings";

type Database = ReturnType<typeof createDatabase>["db"];
type SendQueue = ReturnType<typeof createSendQueue>;

const DISPATCH_BATCH_SIZE = 1_000;
const MAX_CAMPAIGN_BACKLOG = 20_000;
const QUEUE_RUNWAY_SECONDS = 15;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function createCampaignDispatchWorker(input: {
  db: Database;
  env: WorkerEnv;
  sendQueue: SendQueue;
  entitlements: EntitlementService;
}) {
  const { db, env, sendQueue, entitlements } = input;

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

    // Reserve campaign-recipient usage once for the immutable snapshot before
    // any send jobs are published. This keeps quota enforcement ahead of the
    // provider boundary without serializing every individual send on billing.
    const usageReservation = await reserveCampaignRecipientUsage(db, entitlements, {
      organizationId: record.organizationId,
      campaignId: record.campaignId,
    });
    if (!usageReservation.reserved) {
      return { terminal: "paused", reason: usageReservation.reason };
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

      const currentConnection = await prepareConnectionForSend(db, {
        organizationId: record.organizationId,
        phoneNumberId: record.phoneNumberId,
        credentialKey: record.credentialKey,
      });
      if (!currentConnection.sendable) {
        const failedAt = new Date();
        await db
          .update(schema.campaigns)
          .set({ status: "failed", updatedAt: failedAt })
          .where(and(
            eq(schema.campaigns.id, record.campaignId),
            eq(schema.campaigns.organizationId, record.organizationId),
          ));
        return { terminal: "failed", reason: "connection-unavailable" };
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

  return campaignDispatchWorker;
}
