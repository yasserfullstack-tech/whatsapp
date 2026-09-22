import { and, eq, isNotNull, ne, or } from "drizzle-orm";
import { schema } from "@wa/db";
import {
  extractTemplateBodyPreview,
  listMessageTemplates,
} from "@wa/meta";
import {
  missingSynchronizedTemplateIds,
  normalizeMetaTemplateCategory,
  normalizeMetaTemplateStatus,
  stableFingerprint,
} from "./meta-assets";
import { db, env, log, metrics } from "./meta-assets-runtime-context";
import { reconcilePhone } from "./meta-assets-phone-runtime";
import {
  claimStateVersion,
  forceStateVersion,
  loadAccessToken,
  recordAudit,
} from "./meta-assets-state-runtime";

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
