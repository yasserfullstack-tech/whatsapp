import { once } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import { stat, unlink } from "node:fs/promises";
import { Worker, type Job } from "bullmq";
import { and, asc, desc, eq, gt, isNotNull, isNull, lt, lte } from "drizzle-orm";
import { loadWorkerEnv } from "@wa/config";
import { createDatabase, schema } from "@wa/db";
import { createLogger } from "@wa/observability";
import {
  DATA_EXPORT_QUEUE_NAME,
  DATA_LIFECYCLE_QUEUE_NAME,
  createBullConnection,
  createDataLifecycleQueue,
  type DataExportJob,
  type DataLifecycleJob,
} from "@wa/queue";
import { createR2Client, deleteStoredObject, deleteStoredPrefix, putStoredObject } from "@wa/storage";

const env = loadWorkerEnv();
const database = createDatabase(env.DATABASE_URL);
const db = database.db;
const log = createLogger({ service: "worker-data-lifecycle" });
const r2 = createR2Client({
  accountId: env.R2_ACCOUNT_ID,
  accessKeyId: env.R2_ACCESS_KEY_ID,
  secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  bucket: env.R2_BUCKET,
});
const lifecycleQueue = createDataLifecycleQueue(env.REDIS_URL);
const PAGE_SIZE = 1_000;
const DEFAULT_POLICY = {
  rawWebhookDays: 30,
  importFileDays: 7,
  exportFileHours: 24,
  auditLogDays: 365,
  campaignRecipientDays: 365,
};

async function policyFor(organizationId: string) {
  return (await db.select().from(schema.dataRetentionPolicies)
    .where(eq(schema.dataRetentionPolicies.organizationId, organizationId)).limit(1))[0] ?? DEFAULT_POLICY;
}

async function processExport(job: DataExportJob) {
  const exportJob = (await db.select().from(schema.dataExportJobs).where(and(
    eq(schema.dataExportJobs.id, job.exportJobId),
    eq(schema.dataExportJobs.organizationId, job.organizationId),
  )).limit(1))[0];
  if (!exportJob) throw new Error(`Export job ${job.exportJobId} was not found`);
  if (exportJob.status === "completed" || exportJob.status === "expired") return { status: exportJob.status };

  await db.update(schema.dataExportJobs).set({
    status: "processing",
    startedAt: exportJob.startedAt ?? new Date(),
    failedAt: null,
    errorMessage: null,
    updatedAt: new Date(),
  }).where(eq(schema.dataExportJobs.id, exportJob.id));

  const tempPath = `/tmp/wa-export-${exportJob.id}.ndjson`;
  const output = createWriteStream(tempPath, { encoding: "utf8", flags: "w" });
  let rowCount = 0;
  const write = async (type: string, data: unknown) => {
    rowCount += 1;
    if (!output.write(`${JSON.stringify({ type, data })}\n`)) await once(output, "drain");
  };
  const writePaged = async <T extends { id: string }>(type: string, fetchPage: (cursor: string | null) => Promise<T[]>) => {
    let cursor: string | null = null;
    for (;;) {
      const rows = await fetchPage(cursor);
      if (!rows.length) break;
      for (const row of rows) await write(type, row);
      cursor = rows.at(-1)?.id ?? null;
      if (rows.length < PAGE_SIZE) break;
    }
  };

  const writeContacts = () => writePaged("contact", (cursor) => db.select().from(schema.contacts)
    .where(cursor ? and(eq(schema.contacts.organizationId, job.organizationId), gt(schema.contacts.id, cursor)) : eq(schema.contacts.organizationId, job.organizationId))
    .orderBy(asc(schema.contacts.id)).limit(PAGE_SIZE));
  const writeConsent = () => writePaged("consent_event", (cursor) => db.select().from(schema.contactConsentEvents)
    .where(cursor ? and(eq(schema.contactConsentEvents.organizationId, job.organizationId), gt(schema.contactConsentEvents.id, cursor)) : eq(schema.contactConsentEvents.organizationId, job.organizationId))
    .orderBy(asc(schema.contactConsentEvents.id)).limit(PAGE_SIZE));
  const writeRecipients = () => writePaged("campaign_recipient", (cursor) => db.select().from(schema.campaignRecipients)
    .where(cursor ? and(eq(schema.campaignRecipients.organizationId, job.organizationId), gt(schema.campaignRecipients.id, cursor)) : eq(schema.campaignRecipients.organizationId, job.organizationId))
    .orderBy(asc(schema.campaignRecipients.id)).limit(PAGE_SIZE));
  const writeCampaigns = async () => {
    await writePaged("campaign", (cursor) => db.select().from(schema.campaigns)
      .where(cursor ? and(eq(schema.campaigns.organizationId, job.organizationId), gt(schema.campaigns.id, cursor)) : eq(schema.campaigns.organizationId, job.organizationId))
      .orderBy(asc(schema.campaigns.id)).limit(PAGE_SIZE));
    await writeRecipients();
  };

  try {
    await write("manifest", { formatVersion: 2, kind: exportJob.kind, organizationId: job.organizationId, exportedAt: new Date().toISOString() });
    if (exportJob.kind === "contacts") await writeContacts();
    if (exportJob.kind === "consent_history") await writeConsent();
    if (exportJob.kind === "campaign_recipients") await writeRecipients();
    if (exportJob.kind === "campaigns") await writeCampaigns();

    if (exportJob.kind === "workspace") {
      const organization = (await db.select().from(schema.organizations).where(eq(schema.organizations.id, job.organizationId)).limit(1))[0];
      if (organization) await write("organization", organization);
      const preferences = (await db.select().from(schema.workspacePreferences).where(eq(schema.workspacePreferences.organizationId, job.organizationId)).limit(1))[0];
      if (preferences) await write("workspace_preferences", preferences);
      const members = await db.select({
        id: schema.organizationMembers.id,
        userId: schema.users.id,
        email: schema.users.email,
        displayName: schema.users.displayName,
        role: schema.organizationMembers.role,
        joinedAt: schema.organizationMembers.createdAt,
      }).from(schema.organizationMembers).innerJoin(schema.users, eq(schema.users.id, schema.organizationMembers.userId))
        .where(eq(schema.organizationMembers.organizationId, job.organizationId));
      for (const row of members) await write("member", row);
      const invitations = await db.select({
        id: schema.organizationInvitations.id,
        email: schema.organizationInvitations.email,
        role: schema.organizationInvitations.role,
        expiresAt: schema.organizationInvitations.expiresAt,
        acceptedAt: schema.organizationInvitations.acceptedAt,
        createdAt: schema.organizationInvitations.createdAt,
      }).from(schema.organizationInvitations).where(eq(schema.organizationInvitations.organizationId, job.organizationId));
      for (const row of invitations) await write("invitation", row);
      const phoneNumbers = await db.select({
        id: schema.whatsappPhoneNumbers.id,
        wabaId: schema.whatsappPhoneNumbers.wabaId,
        phoneNumberId: schema.whatsappPhoneNumbers.phoneNumberId,
        displayPhoneNumber: schema.whatsappPhoneNumbers.displayPhoneNumber,
        verifiedName: schema.whatsappPhoneNumbers.verifiedName,
        status: schema.whatsappPhoneNumbers.status,
        qualityRating: schema.whatsappPhoneNumbers.qualityRating,
        throughputMps: schema.whatsappPhoneNumbers.throughputMps,
        createdAt: schema.whatsappPhoneNumbers.createdAt,
        updatedAt: schema.whatsappPhoneNumbers.updatedAt,
      }).from(schema.whatsappPhoneNumbers).where(eq(schema.whatsappPhoneNumbers.organizationId, job.organizationId));
      for (const row of phoneNumbers) await write("whatsapp_phone_number", row);
      const imports = await db.select({
        id: schema.contactImports.id,
        originalFileName: schema.contactImports.originalFileName,
        sizeBytes: schema.contactImports.sizeBytes,
        status: schema.contactImports.status,
        totalRows: schema.contactImports.totalRows,
        importedRows: schema.contactImports.importedRows,
        invalidRows: schema.contactImports.invalidRows,
        duplicateRows: schema.contactImports.duplicateRows,
        createdAt: schema.contactImports.createdAt,
        completedAt: schema.contactImports.completedAt,
      }).from(schema.contactImports).where(eq(schema.contactImports.organizationId, job.organizationId));
      for (const row of imports) await write("contact_import", row);
      await writePaged("contact_list", (cursor) => db.select().from(schema.contactLists)
        .where(cursor ? and(eq(schema.contactLists.organizationId, job.organizationId), gt(schema.contactLists.id, cursor)) : eq(schema.contactLists.organizationId, job.organizationId))
        .orderBy(asc(schema.contactLists.id)).limit(PAGE_SIZE));
      await writePaged("contact_list_member", (cursor) => db.select().from(schema.contactListMembers)
        .where(cursor ? and(eq(schema.contactListMembers.organizationId, job.organizationId), gt(schema.contactListMembers.id, cursor)) : eq(schema.contactListMembers.organizationId, job.organizationId))
        .orderBy(asc(schema.contactListMembers.id)).limit(PAGE_SIZE));
      await writePaged("audience_segment", (cursor) => db.select().from(schema.audienceSegments)
        .where(cursor ? and(eq(schema.audienceSegments.organizationId, job.organizationId), gt(schema.audienceSegments.id, cursor)) : eq(schema.audienceSegments.organizationId, job.organizationId))
        .orderBy(asc(schema.audienceSegments.id)).limit(PAGE_SIZE));
      await writePaged("template", (cursor) => db.select().from(schema.templates)
        .where(cursor ? and(eq(schema.templates.organizationId, job.organizationId), gt(schema.templates.id, cursor)) : eq(schema.templates.organizationId, job.organizationId))
        .orderBy(asc(schema.templates.id)).limit(PAGE_SIZE));
      await writeCampaigns();
      await writePaged("campaign_audience", (cursor) => db.select().from(schema.campaignAudiences)
        .where(cursor ? and(eq(schema.campaignAudiences.organizationId, job.organizationId), gt(schema.campaignAudiences.id, cursor)) : eq(schema.campaignAudiences.organizationId, job.organizationId))
        .orderBy(asc(schema.campaignAudiences.id)).limit(PAGE_SIZE));
      await writePaged("suppression", (cursor) => db.select().from(schema.suppressionList)
        .where(cursor ? and(eq(schema.suppressionList.organizationId, job.organizationId), gt(schema.suppressionList.id, cursor)) : eq(schema.suppressionList.organizationId, job.organizationId))
        .orderBy(asc(schema.suppressionList.id)).limit(PAGE_SIZE));
      await writeContacts();
      await writeConsent();
      await writePaged("workspace_audit", (cursor) => db.select().from(schema.workspaceAuditLogs)
        .where(cursor ? and(eq(schema.workspaceAuditLogs.organizationId, job.organizationId), gt(schema.workspaceAuditLogs.id, cursor)) : eq(schema.workspaceAuditLogs.organizationId, job.organizationId))
        .orderBy(asc(schema.workspaceAuditLogs.id)).limit(PAGE_SIZE));
    }

    output.end();
    await once(output, "finish");
    const file = await stat(tempPath);
    await putStoredObject({
      client: r2,
      bucket: env.R2_BUCKET,
      key: exportJob.objectKey,
      body: createReadStream(tempPath),
      contentType: exportJob.contentType,
      contentLength: file.size,
    });
    const policy = await policyFor(job.organizationId);
    const expiresAt = new Date(Date.now() + Math.max(1, Math.min(policy.exportFileHours, 168)) * 60 * 60 * 1_000);
    await db.update(schema.dataExportJobs).set({
      status: "completed",
      rowCount,
      completedAt: new Date(),
      expiresAt,
      updatedAt: new Date(),
    }).where(eq(schema.dataExportJobs.id, exportJob.id));
    await db.insert(schema.dataLifecycleAuditLogs).values({
      organizationId: job.organizationId,
      action: "export.completed",
      targetType: "data_export_job",
      targetId: exportJob.id,
      metadata: { kind: exportJob.kind, rowCount, expiresAt: expiresAt.toISOString() },
    });
    return { rowCount, expiresAt: expiresAt.toISOString() };
  } catch (error) {
    output.destroy();
    await db.update(schema.dataExportJobs).set({
      status: "failed",
      failedAt: new Date(),
      errorMessage: error instanceof Error ? error.message.slice(0, 2_000) : "Unknown export error",
      updatedAt: new Date(),
    }).where(eq(schema.dataExportJobs.id, exportJob.id));
    throw error;
  } finally {
    await unlink(tempPath).catch(() => undefined);
  }
}

async function runRetentionCleanup(onlyOrganizationId?: string) {
  const organizations = onlyOrganizationId
    ? [{ id: onlyOrganizationId }]
    : await db.select({ id: schema.organizations.id }).from(schema.organizations);
  const now = new Date();

  for (const organization of organizations) {
    const policy = await policyFor(organization.id);
    const expiredExports = await db.select().from(schema.dataExportJobs).where(and(
      eq(schema.dataExportJobs.organizationId, organization.id),
      eq(schema.dataExportJobs.status, "completed"),
      isNotNull(schema.dataExportJobs.expiresAt),
      lte(schema.dataExportJobs.expiresAt, now),
    ));
    for (const item of expiredExports) {
      await deleteStoredObject({ client: r2, bucket: env.R2_BUCKET, key: item.objectKey });
      await db.update(schema.dataExportJobs).set({ status: "expired", updatedAt: now }).where(eq(schema.dataExportJobs.id, item.id));
    }

    const importCutoff = new Date(now.getTime() - Math.max(1, policy.importFileDays) * 86_400_000);
    const staleImports = await db.select({ id: schema.contactImports.id, objectKey: schema.contactImports.objectKey })
      .from(schema.contactImports).where(and(
        eq(schema.contactImports.organizationId, organization.id),
        eq(schema.contactImports.status, "completed"),
        isNull(schema.contactImports.objectDeletedAt),
        isNotNull(schema.contactImports.completedAt),
        lt(schema.contactImports.completedAt, importCutoff),
      ));
    for (const item of staleImports) {
      await deleteStoredObject({ client: r2, bucket: env.R2_BUCKET, key: item.objectKey });
      await db.update(schema.contactImports).set({ objectDeletedAt: now, updatedAt: now }).where(eq(schema.contactImports.id, item.id));
    }

    const webhookCutoff = new Date(now.getTime() - Math.max(1, policy.rawWebhookDays) * 86_400_000);
    await db.delete(schema.webhookEvents).where(and(
      eq(schema.webhookEvents.organizationId, organization.id),
      isNotNull(schema.webhookEvents.processedAt),
      lt(schema.webhookEvents.createdAt, webhookCutoff),
    ));

    const auditCutoff = new Date(now.getTime() - Math.max(30, policy.auditLogDays) * 86_400_000);
    await db.delete(schema.workspaceAuditLogs).where(and(
      eq(schema.workspaceAuditLogs.organizationId, organization.id),
      lt(schema.workspaceAuditLogs.createdAt, auditCutoff),
    ));

    const recipientCutoff = new Date(now.getTime() - Math.max(30, policy.campaignRecipientDays) * 86_400_000);
    await database.client`
      DELETE FROM campaign_recipients AS cr
      USING campaigns AS c
      WHERE cr.campaign_id = c.id
        AND cr.organization_id = ${organization.id}
        AND c.status IN ('completed', 'cancelled', 'failed')
        AND COALESCE(c.completed_at, c.updated_at) < ${recipientCutoff}
    `;
  }
}

async function purgeWorkspace(job: Extract<DataLifecycleJob, { type: "workspace-purge" }>, attempt: number, attempts: number) {
  const request = (await db.select().from(schema.workspaceDeletionRequests).where(and(
    eq(schema.workspaceDeletionRequests.id, job.deletionRequestId),
    eq(schema.workspaceDeletionRequests.organizationId, job.organizationId),
  )).limit(1))[0];
  if (!request || request.status === "completed" || request.status === "cancelled") return;

  const organization = (await db.select({ id: schema.organizations.id }).from(schema.organizations)
    .where(eq(schema.organizations.id, job.organizationId)).limit(1))[0];
  if (!organization) {
    await db.update(schema.workspaceDeletionRequests).set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.workspaceDeletionRequests.id, request.id));
    return;
  }

  await db.update(schema.workspaceDeletionRequests).set({ status: "purging", purgeStartedAt: request.purgeStartedAt ?? new Date(), errorMessage: null, updatedAt: new Date() })
    .where(eq(schema.workspaceDeletionRequests.id, request.id));
  try {
    const deletedObjects = await deleteStoredPrefix({ client: r2, bucket: env.R2_BUCKET, prefix: `${job.organizationId}/` });
    await db.delete(schema.organizations).where(eq(schema.organizations.id, job.organizationId));
    await db.update(schema.workspaceDeletionRequests).set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.workspaceDeletionRequests.id, request.id));
    await db.insert(schema.dataLifecycleAuditLogs).values({
      organizationId: job.organizationId,
      action: "workspace.delete.completed",
      targetType: "organization",
      targetId: job.organizationId,
      metadata: { deletedObjects },
    });
  } catch (error) {
    const terminal = attempt >= attempts;
    await db.update(schema.workspaceDeletionRequests).set({
      status: terminal ? "failed" : "disabled",
      failedAt: terminal ? new Date() : null,
      errorMessage: error instanceof Error ? error.message.slice(0, 2_000) : "Unknown purge error",
      updatedAt: new Date(),
    }).where(eq(schema.workspaceDeletionRequests.id, request.id));
    throw error;
  }
}

async function advanceDeletionRequests() {
  const now = new Date();
  const dueToDisable = await db.select().from(schema.workspaceDeletionRequests).where(and(
    eq(schema.workspaceDeletionRequests.status, "cooling_off"),
    lte(schema.workspaceDeletionRequests.coolingOffEndsAt, now),
  ));
  for (const item of dueToDisable) {
    const exists = (await db.select({ id: schema.organizations.id }).from(schema.organizations)
      .where(eq(schema.organizations.id, item.organizationId)).limit(1))[0];
    if (!exists) continue;
    await db.insert(schema.organizationAdminSettings).values({
      organizationId: item.organizationId,
      status: "suspended",
      suspendedAt: now,
      suspendedReason: "Workspace deletion cooling-off period completed",
    }).onConflictDoUpdate({
      target: schema.organizationAdminSettings.organizationId,
      set: { status: "suspended", suspendedAt: now, suspendedReason: "Workspace deletion cooling-off period completed", updatedAt: now },
    });
    await db.update(schema.workspaceDeletionRequests).set({ status: "disabled", disabledAt: now, updatedAt: now })
      .where(eq(schema.workspaceDeletionRequests.id, item.id));
    await db.insert(schema.dataLifecycleAuditLogs).values({
      organizationId: item.organizationId,
      action: "workspace.delete.disabled",
      targetType: "organization",
      targetId: item.organizationId,
      metadata: { purgeAfter: item.purgeAfter.toISOString() },
    });
  }

  const readyToPurge = await db.select().from(schema.workspaceDeletionRequests).where(and(
    eq(schema.workspaceDeletionRequests.status, "disabled"),
    lte(schema.workspaceDeletionRequests.purgeAfter, now),
  ));
  for (const item of readyToPurge) {
    await lifecycleQueue.add("workspace-purge", {
      type: "workspace-purge",
      organizationId: item.organizationId,
      deletionRequestId: item.id,
    }, { jobId: `workspace-purge-${item.id}` });
  }
}

const exportWorker = new Worker<DataExportJob>(DATA_EXPORT_QUEUE_NAME, async (job) => processExport(job.data), {
  connection: createBullConnection(env.REDIS_URL),
  concurrency: Math.max(1, Math.min(env.CONTACT_IMPORT_CONCURRENCY, 4)),
});

const lifecycleWorker = new Worker<DataLifecycleJob>(DATA_LIFECYCLE_QUEUE_NAME, async (job: Job<DataLifecycleJob>) => {
  if (job.data.type === "retention-cleanup") return runRetentionCleanup(job.data.organizationId);
  return purgeWorkspace(job.data, job.attemptsMade + 1, Number(job.opts.attempts ?? 1));
}, {
  connection: createBullConnection(env.REDIS_URL),
  concurrency: 2,
});

exportWorker.on("failed", (job, error) => log.error("data_export_job_failed", { jobId: job?.id, organizationId: job?.data.organizationId, exportJobId: job?.data.exportJobId, error }));
lifecycleWorker.on("failed", (job, error) => log.error("data_lifecycle_job_failed", { jobId: job?.id, organizationId: job?.data.organizationId, type: job?.data.type, error }));

async function scheduleMaintenance() {
  await advanceDeletionRequests();
  const hour = new Date().toISOString().slice(0, 13).replace(/[-T]/g, "");
  await lifecycleQueue.add("retention-cleanup", { type: "retention-cleanup" }, { jobId: `retention-${hour}` }).catch((error) => {
    if (!String(error).includes("already exists")) throw error;
  });
}

const initial = setTimeout(() => void scheduleMaintenance().catch((error) => log.error("data_lifecycle_maintenance_failed", { error })), 5_000);
initial.unref();
const timer = setInterval(() => void scheduleMaintenance().catch((error) => log.error("data_lifecycle_maintenance_failed", { error })), 15 * 60_000);
timer.unref();

async function closeLifecycle() {
  clearInterval(timer);
  clearTimeout(initial);
  await Promise.allSettled([exportWorker.close(true), lifecycleWorker.close(true), lifecycleQueue.close(), database.client.end()]);
}
process.once("SIGINT", () => void closeLifecycle());
process.once("SIGTERM", () => void closeLifecycle());
