import { and, eq } from "drizzle-orm";
import { createDatabase, schema } from "@wa/db";

type Database = ReturnType<typeof createDatabase>["db"];

export class WhatsAppConnectionConflictError extends Error {
  constructor() {
    super("WhatsApp connection conflict");
    this.name = "WhatsAppConnectionConflictError";
  }
}

export async function saveVerifiedWhatsAppConnectionAtomic(
  database: Database,
  input: {
    organizationId: string;
    phone: {
      id: string;
      displayPhoneNumber?: string;
      verifiedName?: string;
      qualityRating?: string;
      throughputMps: number;
    };
    wabaId: string;
    businessId?: string;
    credential: {
      key: string;
      ciphertext: string;
      iv: string;
      authTag: string;
    };
  },
) {
  const expectedCredentialKey = `org/${input.organizationId}/whatsapp/${input.phone.id}/access-token`;
  if (input.credential.key !== expectedCredentialKey) {
    throw new Error("Invalid tenant credential key");
  }

  return database.transaction(async (tx) => {
    const now = new Date();
    const [claimed] = await tx
      .insert(schema.whatsappPhoneNumbers)
      .values({
        organizationId: input.organizationId,
        metaBusinessId: input.businessId ?? null,
        wabaId: input.wabaId,
        phoneNumberId: input.phone.id,
        displayPhoneNumber: input.phone.displayPhoneNumber ?? null,
        verifiedName: input.phone.verifiedName ?? null,
        status: "connected",
        qualityRating: input.phone.qualityRating ?? null,
        throughputMps: input.phone.throughputMps,
        credentialKey: input.credential.key,
      })
      .onConflictDoNothing({ target: schema.whatsappPhoneNumbers.phoneNumberId })
      .returning({
        id: schema.whatsappPhoneNumbers.id,
        organizationId: schema.whatsappPhoneNumbers.organizationId,
      });

    let connection = claimed;
    if (!connection) {
      connection = (
        await tx
          .select({
            id: schema.whatsappPhoneNumbers.id,
            organizationId: schema.whatsappPhoneNumbers.organizationId,
          })
          .from(schema.whatsappPhoneNumbers)
          .where(eq(schema.whatsappPhoneNumbers.phoneNumberId, input.phone.id))
          .limit(1)
      )[0];
    }

    if (!connection || connection.organizationId !== input.organizationId) {
      throw new WhatsAppConnectionConflictError();
    }

    await tx
      .update(schema.whatsappPhoneNumbers)
      .set({
        metaBusinessId: input.businessId ?? null,
        wabaId: input.wabaId,
        displayPhoneNumber: input.phone.displayPhoneNumber ?? null,
        verifiedName: input.phone.verifiedName ?? null,
        status: "connected",
        qualityRating: input.phone.qualityRating ?? null,
        throughputMps: input.phone.throughputMps,
        credentialKey: input.credential.key,
        updatedAt: now,
      })
      .where(and(
        eq(schema.whatsappPhoneNumbers.id, connection.id),
        eq(schema.whatsappPhoneNumbers.organizationId, input.organizationId),
      ));

    await tx
      .insert(schema.credentialSecrets)
      .values({
        organizationId: input.organizationId,
        key: input.credential.key,
        ciphertext: input.credential.ciphertext,
        iv: input.credential.iv,
        authTag: input.credential.authTag,
      })
      .onConflictDoUpdate({
        target: schema.credentialSecrets.key,
        set: {
          ciphertext: input.credential.ciphertext,
          iv: input.credential.iv,
          authTag: input.credential.authTag,
          updatedAt: now,
        },
      });

    return connection;
  });
}
