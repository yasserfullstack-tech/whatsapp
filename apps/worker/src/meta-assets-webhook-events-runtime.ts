import { and, eq, or, sql } from "drizzle-orm";
import { schema } from "@wa/db";
import type { WhatsAppMetaAssetEvent } from "@wa/meta/webhooks";
import {
  accountConnectionStatus,
  accountPhoneStatusAfter,
  matchingPhonesByDisplayNumber,
  normalizeMetaTemplateStatus,
  stableFingerprint,
  webhookEventTime,
} from "./meta-assets";
import { db, log } from "./meta-assets-runtime-context";
import { reconcilePhone } from "./meta-assets-phone-runtime";
import {
  claimStateVersion,
  phonesForWaba,
  recordAudit,
} from "./meta-assets-state-runtime";

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

export async function applyAssetEvent(event: WhatsAppMetaAssetEvent, fallbackAt: Date): Promise<void> {
  if (event.kind === "template_status") return applyTemplateStatus(event, fallbackAt);
  if (event.kind === "phone_name") return applyPhoneName(event, fallbackAt);
  if (event.kind === "phone_quality") return applyPhoneQuality(event);
  if (event.kind === "account_update") return applyAccountUpdate(event, fallbackAt);
  return applyAccountReview(event, fallbackAt);
}
