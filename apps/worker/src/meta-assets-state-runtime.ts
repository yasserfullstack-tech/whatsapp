import { and, eq, sql } from "drizzle-orm";
import { decryptSecret } from "@wa/credentials";
import { createDatabase, schema } from "@wa/db";
import { workerKeyRing } from "./credential-rotation";
import {
  shouldApplyMetaAssetState,
} from "./meta-assets";
import { db, env } from "./meta-assets-runtime-context";

type Database = ReturnType<typeof createDatabase>["db"];
type DbLike = Pick<Database, "select" | "insert" | "update" | "execute">;

export async function recordAudit(
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

export async function claimStateVersion(
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

export async function forceStateVersion(
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

export async function loadAccessToken(input: { organizationId: string; credentialKey: string }): Promise<string> {
  const [secret] = await db
    .select({
      ciphertext: schema.credentialSecrets.ciphertext,
      iv: schema.credentialSecrets.iv,
      authTag: schema.credentialSecrets.authTag,
      keyVersion: schema.credentialSecrets.keyVersion,
    })
    .from(schema.credentialSecrets)
    .where(and(
      eq(schema.credentialSecrets.organizationId, input.organizationId),
      eq(schema.credentialSecrets.key, input.credentialKey),
    ))
    .limit(1);
  if (!secret) throw new Error(`Meta credential ${input.credentialKey} was not found`);
  return decryptSecret(secret, workerKeyRing(env));
}

export type PhoneRow = {
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

export async function phonesForWaba(wabaId: string): Promise<PhoneRow[]> {
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
