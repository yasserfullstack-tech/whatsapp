import { eq } from "drizzle-orm";
import { schema } from "@wa/db";
import {
  getWhatsAppPhoneNumber,
  inferThroughputMps,
} from "@wa/meta";
import { stableFingerprint } from "./meta-assets";
import { db, env } from "./meta-assets-runtime-context";
import {
  forceStateVersion,
  loadAccessToken,
  recordAudit,
  type PhoneRow,
} from "./meta-assets-state-runtime";

export async function reconcilePhone(phone: PhoneRow, observedAt = new Date()): Promise<void> {
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
