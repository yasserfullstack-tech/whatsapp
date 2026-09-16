import { and, asc, eq, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { decryptSecret } from "@wa/credentials";
import { loadWorkerEnv } from "@wa/config";
import { createDatabase, schema } from "@wa/db";
import {
  extractTemplateBodyPreview,
  getWhatsAppPhoneNumber,
  inferThroughputMps,
  listMessageTemplates,
} from "@wa/meta";
import { parseWhatsAppWebhook, type WhatsAppMetaAssetEvent } from "@wa/meta/webhooks";
import { createLogger, MetricsRegistry } from "@wa/observability";
import {
  accountConnectionStatus,
  accountPhoneStatusAfter,
  matchingPhonesByDisplayNumber,
  missingSynchronizedTemplateIds,
  normalizeMetaTemplateCategory,
  normalizeMetaTemplateStatus,
  shouldApplyMetaAssetState,
  stableFingerprint,
  webhookEventTime,
} from "./meta-assets";

const env = loadWorkerEnv();
const database = createDatabase(env.DATABASE_URL);
const db = database.db;
type Database = typeof db;
type DbLike = Pick<Database, "select" | "insert" | "update" | "execute">;

const log = createLogger({ service: "worker-meta-assets" });
const metrics = new MetricsRegistry();

export const META_ASSET_WEBHOOK_SCAN_INTERVAL_MS = 5_000;
export const META_ASSET_RECONCILE_INTERVAL_MS = 15 * 60_000;
const META_ASSET_BATCH_SIZE = 200;
const META_ASSET_STALE_PROCESSING_MS = 5 * 60_000;
const META_ASSET_MAX_PROCESSING_ATTEMPTS = 12;
const META_ASSET_MAX_RETRY_MS = 15 * 60_000;

metrics.defineCounter("whatsapp_meta_asset_webhook_events_total", "Meta asset webhook receipts by outcome", ["outcome"]);
metrics.defineCounter("whatsapp_meta_asset_sync_failures_total", "Meta asset synchronization failures by operation", ["operation"]);
metrics.defineCounter("whatsapp_meta_asset_reconciliation_total", "Meta asset reconciliation runs by outcome", ["outcome"]);
metrics.defineGauge("whatsapp_meta_asset_dead_letter_events", "Meta asset webhook receipts that exhausted processing attempts");
metrics.defineGauge("whatsapp_meta_asset_reconciliation_last_success_timestamp_seconds", "Unix timestamp of the last successful Meta asset reconciliation");
metrics.defineHistogram("whatsapp_meta_asset_reconciliation_duration_seconds", "Meta asset reconciliation duration in seconds");

function errorText(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000);
}

function retryDelayMs(attempt: number): number {
  return Math.min(META_ASSET_MAX_RETRY_MS, 1_000 * (2 ** Math.min(20, Math.max(0, attempt - 1))));
}

async function recordAudit(
  tx: DbLike,
  input: {
    organizationId: string | null;
    action: string;
    targetType: string;
    targetId: string;
    metadata: Record<string, unknown>;
  },
) {
  await tx.insert(schema.platformAuditEvents).values({
    actorAuthUserId: null,
    organizationId: input.organizationId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    metadata: input.metadata,
  });
}

async function claimStateVersion(
  tx: DbLike,
  input: {
    resourceType: string;
    resourceKey: string;
    providerEventAt: Date;
    fingerprint: string;
    source: string;
  },
): Promise<boolean> {
  const lockKey = `meta-asset:${input.resourceType}:${input.resourceKey}`;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`);

  const [current] = await tx
    .select({
      providerEventAt: schema.metaAssetStateVersions.providerEventAt,
      fingerprint: schema.metaAssetStateVersions.fingerprint,
    })
    .from(schema.metaAssetStateVersions)
    .where(and(
      eq(schema.metaAssetStateVersions.resourceType, input.resourceType),
      eq(schema.metaAssetStateVersions.resourceKey, input.resourceKey),
    ))
    .limit(1);

  if (!shouldApplyMetaAssetState(current, input.providerEventAt, input.fingerprint)) return false;

  await tx
    .insert(schema.metaAssetStateVersions)
    .values({
      resourceType: input.resourceType,
      resourceKey: input.resourceKey,
      providerEventAt: input.providerEventAt,
      fingerprint: input.fingerprint,
      source: input.source,
    })
    .onConflictDoUpdate({
      target: [schema.metaAssetStateVersions.resourceType, schema.metaAssetStateVersions.resourceKey],
      set: {
        providerEventAt: input.providerEventAt,
        fingerprint: input.fingerprint,
        source: input.source,
        updatedAt: new Date(),
      },
    });
  return true;
}

async function forceStateVersion(
  tx: DbLike,
  input: {
    resourceType: string;
    resourceKey: string;
    providerEventAt: Date;
    fingerprint: string;
    source: string;
  },
) {
  await tx
    .insert(schema.metaAssetStateVersions)
    .values(input)
    .onConflictDoUpdate({
      target: [schema.metaAssetStateVersions.resourceType, schema.metaAssetStateVersions.resourceKey],
      set: {
        providerEventAt: input.providerEventAt,
        fingerprint: input.fingerprint,
        source: input.source,
        updatedAt: new Date(),
      },
    });
}

async function loadAccessToken(input: { organizationId: string; credentialKey: string }): Promise<string> {
  const [secret] = await db
    .select({
      ciphertext: schema.credentialSecrets.ciphertext,
      iv: schema.credentialSecrets.iv,
      authTag: schema.credentialSecrets.authTag,
    })
    .from(schema.credentialSecrets)
    .where(and(
      eq(schema.credentialSecrets.organizationId, input.organizationId),
      eq(schema.credentialSecrets.key, input.credentialKey),
    ))
    .limit(1);
  if (!secret) throw new Error(`Meta credential ${input.credentialKey} was not found`);
  return decryptSecret(secret, env.CREDENTIAL_ENCRYPTION_KEY);
}

type PhoneRow = {
  id: string;
  organizationId: string;
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  status: "pending" | "connected" | "restricted" | "disconnected";
  qualityRating: string | null;
  throughputMps: number;
  credentialKey: string;
};

async function phonesForWaba(wabaId: string): Promise<PhoneRow[]> {
  return db
    .select({
      id: schema.whatsappPhoneNumbers.id,
      organizationId: schema.whatsappPhoneNumbers.organizationId,
      wabaId: schema.whatsappPhoneNumbers.wabaId,
      phoneNumberId: schema.whatsappPhoneNumbers.phoneNumberId,
      displayPhoneNumber: schema.whatsappPhoneNumbers.displayPhoneNumber,
      verifiedName: schema.whatsappPhoneNumbers.verifiedName,
      status: schema.whatsappPhoneNumbers.status,
      qualityRating: schema.whatsappPhoneNumbers.qualityRating,
      throughputMps: schema.whatsappPhoneNumbers.throughputMps,
      credentialKey: schema.whatsappPhoneNumbers.credentialKey,
    })
    .from(schema.whatsappPhoneNumbers)
    .where(eq(schema.whatsappPhoneNumbers.wabaId, wabaId));
}

async function reconcilePhone(phone: PhoneRow, observedAt = new Date()): Promise<void> {
  const accessToken = await loadAccessToken(phone);
  const remote = await getWhatsAppPhoneNumber({
    phoneNumberId: phone.phoneNumberId,
    accessToken,
    graphApiVersion: env.META_GRAPH_API_VERSION,
  });

  const nextDisplayPhoneNumber = remote.displayPhoneNumber ?? phone.displayPhoneNumber;
  const nextVerifiedName = remote.verifiedName ?? phone.verifiedName;
  const nextQualityRating = remote.qualityRating ?? phone.qualityRating;
  const nextThroughputMps = remote.throughputLevel ? inferThroughputMps(remote.throughputLevel) : phone.throughputMps;
  const nameFingerprint = stableFingerprint({
    displayPhoneNumber: nextDisplayPhoneNumber,
    verifiedName: nextVerifiedName,
  });
  const qualityFingerprint = stableFingerprint({
    qualityRating: nextQualityRating,
    throughputMps: nextThroughputMps,
  });

  await db.transaction(async (tx) => {
    const nameChanged = phone.displayPhoneNumber !== nextDisplayPhoneNumber || phone.verifiedName !== nextVerifiedName;
    const qualityChanged = phone.qualityRating !== nextQualityRating || phone.throughputMps !== nextThroughputMps;

    await tx
      .update(schema.whatsappPhoneNumbers)
      .set({
        displayPhoneNumber: nextDisplayPhoneNumber,
        verifiedName: nextVerifiedName,
        qualityRating: nextQualityRating,
        throughputMps: nextThroughputMps,
        updatedAt: new Date(),
      })
      .where(eq(schema.whatsappPhoneNumbers.id, phone.id));

    await forceStateVersion(tx, {
      resourceType: "phone_name",
      resourceKey: phone.id,
      providerEventAt: observedAt,
      fingerprint: nameFingerprint,
      source: "reconciliation",
    });
    await forceStateVersion(tx, {
      resourceType: "phone_quality",
      resourceKey: phone.id,
      providerEventAt: observedAt,
      fingerprint: qualityFingerprint,
      source: "reconciliation",
    });

    if (nameChanged) {
      await recordAudit(tx, {
        organizationId: phone.organizationId,
        action: "meta.asset.phone_name_reconciled",
        targetType: "whatsapp_phone_number",
        targetId: phone.id,
        metadata: {
          phoneNumberId: phone.phoneNumberId,
          before: { displayPhoneNumber: phone.displayPhoneNumber, verifiedName: phone.verifiedName },
          after: { displayPhoneNumber: nextDisplayPhoneNumber, verifiedName: nextVerifiedName },
        },
      });
    }
    if (qualityChanged) {
      await recordAudit(tx, {
        organizationId: phone.organizationId,
        action: "meta.asset.phone_quality_reconciled",
        targetType: "whatsapp_phone_number",
        targetId: phone.id,
        metadata: {
          phoneNumberId: phone.phoneNumberId,
          before: { qualityRating: phone.qualityRating, throughputMps: phone.throughputMps },
          after: { qualityRating: nextQualityRating, throughputMps: nextThroughputMps },
        },
      });
    }
  });
}

async function applyTemplateStatus(event: Extract<WhatsAppMetaAssetEvent, { kind: "template_status" }>, fallbackAt: Date) {
  const [template] = await db
    .select({
      id: schema.templates.id,
      organizationId: schema.templates.organizationId,
      status: schema.templates.status,
      metaStatus: schema.templates.metaStatus,
      rejectionReason: schema.templates.rejectionReason,
    })
    .from(schema.templates)
    .where(or(
      eq(schema.templates.metaTemplateId, event.templateId),
      and(
        eq(schema.templates.wabaId, event.wabaId),
        event.templateName ? eq(schema.templates.name, event.templateName) : sql`false`,
        event.language ? eq(schema.templates.language, event.language) : sql`false`,
      ),
    ))
    .limit(1);
  if (!template) {
    log.warn("meta_asset_template_webhook_unmatched", { wabaId: event.wabaId, templateId: event.templateId });
    return;
  }

  const providerEventAt = webhookEventTime(event.timestampSeconds, fallbackAt);
  const status = normalizeMetaTemplateStatus(event.event);
  const rejectionReason = status === "rejected" ? event.reason ?? null : null;
  const fingerprint = stableFingerprint({ status, metaStatus: event.event, rejectionReason });

  await db.transaction(async (tx) => {
    if (!await claimStateVersion(tx, {
      resourceType: "template_status",
      resourceKey: template.id,
      providerEventAt,
      fingerprint,
      source: "webhook",
    })) return;

    const changed = template.status !== status || template.metaStatus !== event.event || template.rejectionReason !== rejectionReason;
    await tx
      .update(schema.templates)
      .set({
        status,
        metaStatus: event.event,
        rejectionReason,
        lastSyncedAt: providerEventAt,
        updatedAt: new Date(),
      })
      .where(eq(schema.templates.id, template.id));

    if (changed) {
      await recordAudit(tx, {
        organizationId: template.organizationId,
        action: "meta.asset.template_status_changed",
        targetType: "template",
        targetId: template.id,
        metadata: {
          metaTemplateId: event.templateId,
          wabaId: event.wabaId,
          before: { status: template.status, metaStatus: template.metaStatus, rejectionReason: template.rejectionReason },
          after: { status, metaStatus: event.event, rejectionReason },
          providerEventAt: providerEventAt.toISOString(),
        },
      });
    }
  });
}

async function applyPhoneName(event: Extract<WhatsAppMetaAssetEvent, { kind: "phone_name" }>, fallbackAt: Date) {
  const phones = matchingPhonesByDisplayNumber(await phonesForWaba(event.wabaId), event.displayPhoneNumber);
  const providerEventAt = webhookEventTime(event.timestampSeconds, fallbackAt);

  for (const phone of phones) {
    const nextVerifiedName = event.decision === "APPROVED" && event.requestedVerifiedName
      ? event.requestedVerifiedName
      : phone.verifiedName;
    const nextDisplay = event.displayPhoneNumber ?? phone.displayPhoneNumber;
    const fingerprint = stableFingerprint({
      decision: event.decision,
      requestedVerifiedName: event.requestedVerifiedName,
      rejectionReason: event.rejectionReason,
      displayPhoneNumber: nextDisplay,
    });

    await db.transaction(async (tx) => {
      if (!await claimStateVersion(tx, {
        resourceType: "phone_name",
        resourceKey: phone.id,
        providerEventAt,
        fingerprint,
        source: "webhook",
      })) return;

      if (event.decision === "APPROVED") {
        await tx.update(schema.whatsappPhoneNumbers).set({
          displayPhoneNumber: nextDisplay,
          verifiedName: nextVerifiedName,
          updatedAt: new Date(),
        }).where(eq(schema.whatsappPhoneNumbers.id, phone.id));
      }

      await recordAudit(tx, {
        organizationId: phone.organizationId,
        action: "meta.asset.phone_name_changed",
        targetType: "whatsapp_phone_number",
        targetId: phone.id,
        metadata: {
          phoneNumberId: phone.phoneNumberId,
          decision: event.decision,
          requestedVerifiedName: event.requestedVerifiedName,
          rejectionReason: event.rejectionReason,
          providerEventAt: providerEventAt.toISOString(),
        },
      });
    });
  }
}

async function applyPhoneQuality(event: Extract<WhatsAppMetaAssetEvent, { kind: "phone_quality" }>) {
  const phones = matchingPhonesByDisplayNumber(await phonesForWaba(event.wabaId), event.displayPhoneNumber);
  for (const phone of phones) {
    await reconcilePhone(phone, new Date());
  }
}

async function applyAccountUpdate(event: Extract<WhatsAppMetaAssetEvent, { kind: "account_update" }>, fallbackAt: Date) {
  const phones = await phonesForWaba(event.wabaId);
  const providerEventAt = webhookEventTime(event.timestampSeconds, fallbackAt);
  const nextStatus = accountConnectionStatus(event);
  const fingerprint = stableFingerprint({ event: event.event, banState: event.banState, banDate: event.banDate });
  const organizationId = phones[0]?.organizationId ?? null;

  await db.transaction(async (tx) => {
    if (!await claimStateVersion(tx, {
      resourceType: "waba_account",
      resourceKey: event.wabaId,
      providerEventAt,
      fingerprint,
      source: "webhook",
    })) return;

    let transitionedPhones = 0;
    if (nextStatus) {
      for (const phone of phones) {
        const effectiveStatus = accountPhoneStatusAfter(phone.status, nextStatus);
        if (effectiveStatus === phone.status) continue;
        const [updated] = await tx
          .update(schema.whatsappPhoneNumbers)
          .set({ status: effectiveStatus, updatedAt: new Date() })
          .where(and(
            eq(schema.whatsappPhoneNumbers.id, phone.id),
            eq(schema.whatsappPhoneNumbers.status, phone.status),
          ))
          .returning({ id: schema.whatsappPhoneNumbers.id });
        if (updated) transitionedPhones += 1;
      }
    }

    await recordAudit(tx, {
      organizationId,
      action: "meta.asset.waba_account_changed",
      targetType: "whatsapp_business_account",
      targetId: event.wabaId,
      metadata: {
        event: event.event,
        banState: event.banState,
        banDate: event.banDate,
        connectionStatus: nextStatus,
        transitionedPhones,
        providerEventAt: providerEventAt.toISOString(),
      },
    });
  });
}

async function applyAccountReview(event: Extract<WhatsAppMetaAssetEvent, { kind: "account_review" }>, fallbackAt: Date) {
  const phones = await phonesForWaba(event.wabaId);
  const providerEventAt = webhookEventTime(event.timestampSeconds, fallbackAt);
  const fingerprint = stableFingerprint({ decision: event.decision });

  await db.transaction(async (tx) => {
    if (!await claimStateVersion(tx, {
      resourceType: "waba_review",
      resourceKey: event.wabaId,
      providerEventAt,
      fingerprint,
      source: "webhook",
    })) return;

    await recordAudit(tx, {
      organizationId: phones[0]?.organizationId ?? null,
      action: "meta.asset.waba_review_changed",
      targetType: "whatsapp_business_account",
      targetId: event.wabaId,
      metadata: { decision: event.decision, providerEventAt: providerEventAt.toISOString() },
    });
  });
}

async function applyAssetEvent(event: WhatsAppMetaAssetEvent, fallbackAt: Date): Promise<void> {
  if (event.kind === "template_status") return applyTemplateStatus(event, fallbackAt);
  if (event.kind === "phone_name") return applyPhoneName(event, fallbackAt);
  if (event.kind === "phone_quality") return applyPhoneQuality(event);
  if (event.kind === "account_update") return applyAccountUpdate(event, fallbackAt);
  return applyAccountReview(event, fallbackAt);
}

async function claimReceipt(eventId: string): Promise<{ attempt: number } | null> {
  await db.insert(schema.metaAssetWebhookReceipts).values({ eventId }).onConflictDoNothing();
  const staleBefore = new Date(Date.now() - META_ASSET_STALE_PROCESSING_MS);
  const [claimed] = await db
    .update(schema.metaAssetWebhookReceipts)
    .set({
      processingStatus: "processing",
      processingAttempts: sql`${schema.metaAssetWebhookReceipts.processingAttempts} + 1`,
      lastError: null,
      nextRetryAt: null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(schema.metaAssetWebhookReceipts.eventId, eventId),
      isNull(schema.metaAssetWebhookReceipts.processedAt),
      or(
        ne(schema.metaAssetWebhookReceipts.processingStatus, "processing"),
        lte(schema.metaAssetWebhookReceipts.updatedAt, staleBefore),
      ),
    ))
    .returning({ attempt: schema.metaAssetWebhookReceipts.processingAttempts });
  return claimed ?? null;
}

async function finishReceipt(eventId: string) {
  await db.update(schema.metaAssetWebhookReceipts).set({
    processingStatus: "processed",
    lastError: null,
    nextRetryAt: null,
    processedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(schema.metaAssetWebhookReceipts.eventId, eventId));
}

async function failReceipt(eventId: string, attempt: number, error: unknown) {
  const deadLetter = attempt >= META_ASSET_MAX_PROCESSING_ATTEMPTS;
  await db.update(schema.metaAssetWebhookReceipts).set({
    processingStatus: deadLetter ? "dead_letter" : "retry",
    lastError: errorText(error),
    nextRetryAt: deadLetter ? null : new Date(Date.now() + retryDelayMs(attempt)),
    updatedAt: new Date(),
  }).where(eq(schema.metaAssetWebhookReceipts.eventId, eventId));
  metrics.incCounter("whatsapp_meta_asset_webhook_events_total", { outcome: deadLetter ? "dead_letter" : "retry" });
}

async function refreshDeadLetterMetric() {
  const [row] = await db.select({ total: sql<number>`count(*)::int` })
    .from(schema.metaAssetWebhookReceipts)
    .where(eq(schema.metaAssetWebhookReceipts.processingStatus, "dead_letter"));
  metrics.setGauge("whatsapp_meta_asset_dead_letter_events", Number(row?.total ?? 0));
}

export async function processMetaAssetWebhookReceipts(): Promise<{ inspected: number; processed: number }> {
  const now = new Date();
  const candidates = await db
    .select({
      id: schema.webhookEvents.id,
      payload: schema.webhookEvents.payload,
      createdAt: schema.webhookEvents.createdAt,
    })
    .from(schema.webhookEvents)
    .leftJoin(schema.metaAssetWebhookReceipts, eq(schema.metaAssetWebhookReceipts.eventId, schema.webhookEvents.id))
    .where(and(
      isNotNull(schema.webhookEvents.processedAt),
      or(
        isNull(schema.metaAssetWebhookReceipts.eventId),
        and(
          isNull(schema.metaAssetWebhookReceipts.processedAt),
          ne(schema.metaAssetWebhookReceipts.processingStatus, "dead_letter"),
          or(
            isNull(schema.metaAssetWebhookReceipts.nextRetryAt),
            lte(schema.metaAssetWebhookReceipts.nextRetryAt, now),
          ),
        ),
      ),
    ))
    .orderBy(asc(schema.webhookEvents.createdAt))
    .limit(META_ASSET_BATCH_SIZE);

  let processed = 0;
  for (const candidate of candidates) {
    const receipt = await claimReceipt(candidate.id);
    if (!receipt) continue;
    try {
      const parsed = parseWhatsAppWebhook(candidate.payload);
      for (const event of parsed.assetEvents) await applyAssetEvent(event, candidate.createdAt);
      await finishReceipt(candidate.id);
      metrics.incCounter("whatsapp_meta_asset_webhook_events_total", { outcome: "processed" });
      processed += 1;
    } catch (error) {
      metrics.incCounter("whatsapp_meta_asset_sync_failures_total", { operation: "webhook" });
      await failReceipt(candidate.id, receipt.attempt, error);
      log.error("meta_asset_webhook_processing_failed", { eventId: candidate.id, attempt: receipt.attempt, error });
    }
  }
  await refreshDeadLetterMetric();
  return { inspected: candidates.length, processed };
}

async function reconcileTemplatesForWaba(input: {
  organizationId: string;
  wabaId: string;
  credentialKey: string;
  observedAt: Date;
}): Promise<number> {
  const accessToken = await loadAccessToken(input);
  const remoteTemplates = await listMessageTemplates({
    wabaId: input.wabaId,
    accessToken,
    graphApiVersion: env.META_GRAPH_API_VERSION,
  });

  for (const remote of remoteTemplates) {
    await db.transaction(async (tx) => {
      const [existing] = await tx.select({
        id: schema.templates.id,
        status: schema.templates.status,
        metaStatus: schema.templates.metaStatus,
      }).from(schema.templates).where(or(
        eq(schema.templates.metaTemplateId, remote.id),
        and(
          eq(schema.templates.organizationId, input.organizationId),
          eq(schema.templates.wabaId, input.wabaId),
          eq(schema.templates.name, remote.name),
          eq(schema.templates.language, remote.language),
        ),
      )).limit(1);

      const values = {
        organizationId: input.organizationId,
        wabaId: input.wabaId,
        metaTemplateId: remote.id,
        name: remote.name,
        language: remote.language,
        category: normalizeMetaTemplateCategory(remote.category),
        status: normalizeMetaTemplateStatus(remote.status),
        metaStatus: remote.status,
        bodyPreview: extractTemplateBodyPreview(remote.components) ?? null,
        components: remote.components,
        rejectionReason: remote.rejectedReason ?? null,
        lastSyncedAt: input.observedAt,
        updatedAt: new Date(),
      } as const;

      let templateId = existing?.id;
      if (existing) {
        await tx.update(schema.templates).set(values).where(eq(schema.templates.id, existing.id));
      } else {
        const [inserted] = await tx.insert(schema.templates).values(values).onConflictDoUpdate({
          target: [schema.templates.organizationId, schema.templates.wabaId, schema.templates.name, schema.templates.language],
          set: values,
        }).returning({ id: schema.templates.id });
        templateId = inserted?.id;
      }
      if (!templateId) return;

      await forceStateVersion(tx, {
        resourceType: "template_status",
        resourceKey: templateId,
        providerEventAt: input.observedAt,
        fingerprint: stableFingerprint({ status: values.status, metaStatus: values.metaStatus, rejectionReason: values.rejectionReason }),
        source: "reconciliation",
      });

      if (!existing || existing.status !== values.status || existing.metaStatus !== values.metaStatus) {
        await recordAudit(tx, {
          organizationId: input.organizationId,
          action: "meta.asset.template_reconciled",
          targetType: "template",
          targetId: templateId,
          metadata: { metaTemplateId: remote.id, status: values.status, metaStatus: values.metaStatus },
        });
      }
    });
  }

  const localTemplates = await db
    .select({
      id: schema.templates.id,
      metaTemplateId: schema.templates.metaTemplateId,
      status: schema.templates.status,
      metaStatus: schema.templates.metaStatus,
    })
    .from(schema.templates)
    .where(and(
      eq(schema.templates.organizationId, input.organizationId),
      eq(schema.templates.wabaId, input.wabaId),
      isNotNull(schema.templates.metaTemplateId),
    ));
  const missingIds = new Set(missingSynchronizedTemplateIds(
    localTemplates,
    new Set(remoteTemplates.map((template) => template.id)),
  ));

  for (const template of localTemplates) {
    if (!missingIds.has(template.id)) continue;
    await db.transaction(async (tx) => {
      const fingerprint = stableFingerprint({
        status: "disabled",
        metaStatus: template.metaStatus,
        reason: "missing_from_provider_listing",
      });
      if (!await claimStateVersion(tx, {
        resourceType: "template_status",
        resourceKey: template.id,
        providerEventAt: input.observedAt,
        fingerprint,
        source: "reconciliation",
      })) return;

      await tx.update(schema.templates).set({
        status: "disabled",
        lastSyncedAt: input.observedAt,
        updatedAt: new Date(),
      }).where(eq(schema.templates.id, template.id));

      if (template.status !== "disabled") {
        await recordAudit(tx, {
          organizationId: input.organizationId,
          action: "meta.asset.template_missing_reconciled",
          targetType: "template",
          targetId: template.id,
          metadata: {
            metaTemplateId: template.metaTemplateId,
            beforeStatus: template.status,
            afterStatus: "disabled",
            reason: "missing_from_provider_listing",
          },
        });
      }
    });
  }

  return remoteTemplates.length + missingIds.size;
}

export async function reconcileMetaAssets(): Promise<{ phones: number; templates: number; failures: number }> {
  const observedAt = new Date();
  const phones = await db
    .select({
      id: schema.whatsappPhoneNumbers.id,
      organizationId: schema.whatsappPhoneNumbers.organizationId,
      wabaId: schema.whatsappPhoneNumbers.wabaId,
      phoneNumberId: schema.whatsappPhoneNumbers.phoneNumberId,
      displayPhoneNumber: schema.whatsappPhoneNumbers.displayPhoneNumber,
      verifiedName: schema.whatsappPhoneNumbers.verifiedName,
      status: schema.whatsappPhoneNumbers.status,
      qualityRating: schema.whatsappPhoneNumbers.qualityRating,
      throughputMps: schema.whatsappPhoneNumbers.throughputMps,
      credentialKey: schema.whatsappPhoneNumbers.credentialKey,
    })
    .from(schema.whatsappPhoneNumbers)
    .where(ne(schema.whatsappPhoneNumbers.status, "disconnected"));

  let reconciledPhones = 0;
  let failures = 0;
  for (const phone of phones) {
    try {
      await reconcilePhone(phone, observedAt);
      reconciledPhones += 1;
    } catch (error) {
      failures += 1;
      metrics.incCounter("whatsapp_meta_asset_sync_failures_total", { operation: "phone_reconciliation" });
      log.error("meta_asset_phone_reconciliation_failed", {
        organizationId: phone.organizationId,
        wabaId: phone.wabaId,
        phoneNumberId: phone.phoneNumberId,
        error,
      });
    }
  }

  const uniqueWabas = new Map<string, { organizationId: string; wabaId: string; credentialKey: string }>();
  for (const phone of phones) {
    uniqueWabas.set(`${phone.organizationId}:${phone.wabaId}`, {
      organizationId: phone.organizationId,
      wabaId: phone.wabaId,
      credentialKey: phone.credentialKey,
    });
  }

  let templateCount = 0;
  for (const waba of uniqueWabas.values()) {
    try {
      templateCount += await reconcileTemplatesForWaba({ ...waba, observedAt });
    } catch (error) {
      failures += 1;
      metrics.incCounter("whatsapp_meta_asset_sync_failures_total", { operation: "template_reconciliation" });
      log.error("meta_asset_template_reconciliation_failed", {
        organizationId: waba.organizationId,
        wabaId: waba.wabaId,
        error,
      });
    }
  }
  return { phones: reconciledPhones, templates: templateCount, failures };
}

let scanRunning = false;
async function scan() {
  if (scanRunning) return;
  scanRunning = true;
  try {
    const result = await processMetaAssetWebhookReceipts();
    if (result.processed > 0) log.info("meta_asset_webhooks_processed", result);
  } catch (error) {
    metrics.incCounter("whatsapp_meta_asset_sync_failures_total", { operation: "scanner" });
    log.error("meta_asset_webhook_scanner_failed", { error });
  } finally {
    scanRunning = false;
  }
}

let reconciliationRunning = false;
async function reconcile() {
  if (reconciliationRunning) return;
  reconciliationRunning = true;
  const startedAt = performance.now();
  try {
    const result = await reconcileMetaAssets();
    const outcome = result.failures > 0 ? "partial" : "success";
    metrics.incCounter("whatsapp_meta_asset_reconciliation_total", { outcome });
    if (result.failures === 0) {
      metrics.setGauge("whatsapp_meta_asset_reconciliation_last_success_timestamp_seconds", Date.now() / 1_000);
      log.info("meta_asset_reconciliation_completed", result);
    } else {
      log.warn("meta_asset_reconciliation_completed_with_failures", result);
    }
  } catch (error) {
    metrics.incCounter("whatsapp_meta_asset_reconciliation_total", { outcome: "failed" });
    metrics.incCounter("whatsapp_meta_asset_sync_failures_total", { operation: "reconciliation" });
    log.error("meta_asset_reconciliation_failed", { error });
  } finally {
    metrics.observeHistogram("whatsapp_meta_asset_reconciliation_duration_seconds", (performance.now() - startedAt) / 1_000);
    reconciliationRunning = false;
  }
}

void scan();
void reconcile();
const scanInterval = setInterval(() => void scan(), META_ASSET_WEBHOOK_SCAN_INTERVAL_MS);
const reconciliationInterval = setInterval(() => void reconcile(), META_ASSET_RECONCILE_INTERVAL_MS);
scanInterval.unref?.();
reconciliationInterval.unref?.();