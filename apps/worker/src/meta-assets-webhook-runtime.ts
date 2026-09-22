import { and, asc, eq, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { schema } from "@wa/db";
import { parseWhatsAppWebhook, type WhatsAppMetaAssetEvent } from "@wa/meta/webhooks";
import {
  accountConnectionStatus,
  accountPhoneStatusAfter,
  matchingPhonesByDisplayNumber,
  normalizeMetaTemplateStatus,
  stableFingerprint,
  webhookEventTime,
} from "./meta-assets";
import {
  db,
  log,
  metrics,
  META_ASSET_BATCH_SIZE,
  META_ASSET_MAX_PROCESSING_ATTEMPTS,
  META_ASSET_MAX_RETRY_MS,
  META_ASSET_STALE_PROCESSING_MS,
} from "./meta-assets-runtime-context";
import { reconcilePhone } from "./meta-assets-phone-runtime";
import {
  claimStateVersion,
  phonesForWaba,
  recordAudit,
} from "./meta-assets-state-runtime";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000);
}

function retryDelayMs(attempt: number): number {
  return Math.min(META_ASSET_MAX_RETRY_MS, 1_000 * (2 ** Math.min(20, Math.max(0, attempt - 1))));
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
