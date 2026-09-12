import { and, eq } from "drizzle-orm";
import { decryptSecret } from "@wa/credentials";
import { schema } from "@wa/db";
import { db, getCredentialEncryptionKey } from "./server";

export type ConnectedWaba = {
  wabaId: string;
  label: string;
  phoneNumberId: string;
};

export async function listConnectedWabas(organizationId: string): Promise<ConnectedWaba[]> {
  const phones = await db
    .select({
      wabaId: schema.whatsappPhoneNumbers.wabaId,
      phoneNumberId: schema.whatsappPhoneNumbers.phoneNumberId,
      displayPhoneNumber: schema.whatsappPhoneNumbers.displayPhoneNumber,
      verifiedName: schema.whatsappPhoneNumbers.verifiedName,
    })
    .from(schema.whatsappPhoneNumbers)
    .where(
      and(
        eq(schema.whatsappPhoneNumbers.organizationId, organizationId),
        eq(schema.whatsappPhoneNumbers.status, "connected"),
      ),
    );

  const byWaba = new Map<string, ConnectedWaba>();
  for (const phone of phones) {
    if (byWaba.has(phone.wabaId)) continue;
    const label = [phone.verifiedName, phone.displayPhoneNumber].filter(Boolean).join(" · ") || `WABA ${phone.wabaId}`;
    byWaba.set(phone.wabaId, {
      wabaId: phone.wabaId,
      label,
      phoneNumberId: phone.phoneNumberId,
    });
  }

  return [...byWaba.values()];
}

export async function getWabaAccessToken(organizationId: string, wabaId: string): Promise<string> {
  const [phone] = await db
    .select({ credentialKey: schema.whatsappPhoneNumbers.credentialKey })
    .from(schema.whatsappPhoneNumbers)
    .where(
      and(
        eq(schema.whatsappPhoneNumbers.organizationId, organizationId),
        eq(schema.whatsappPhoneNumbers.wabaId, wabaId),
        eq(schema.whatsappPhoneNumbers.status, "connected"),
      ),
    )
    .limit(1);

  if (!phone) throw new Error("Connected WABA was not found in this workspace");

  const [secret] = await db
    .select({
      ciphertext: schema.credentialSecrets.ciphertext,
      iv: schema.credentialSecrets.iv,
      authTag: schema.credentialSecrets.authTag,
    })
    .from(schema.credentialSecrets)
    .where(
      and(
        eq(schema.credentialSecrets.organizationId, organizationId),
        eq(schema.credentialSecrets.key, phone.credentialKey),
      ),
    )
    .limit(1);

  if (!secret) throw new Error("Meta credential was not found for this WABA");
  return decryptSecret(secret, getCredentialEncryptionKey());
}
