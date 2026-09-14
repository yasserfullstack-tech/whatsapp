import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createDatabase, schema } from "@wa/db";
import {
  WhatsAppConnectionConflictError,
  saveVerifiedWhatsAppConnectionAtomic,
} from "./whatsapp-connection";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for WhatsApp connection tests");

describe("verified WhatsApp connection persistence", () => {
  test("two organizations cannot race the same Meta phone into cross-tenant credential corruption", async () => {
    const database = createDatabase(databaseUrl);
    const db = database.db;
    const suffix = randomUUID();
    const organizations = await db.insert(schema.organizations).values([
      { name: `Connection race A ${suffix}`, slug: `connection-race-a-${suffix}` },
      { name: `Connection race B ${suffix}`, slug: `connection-race-b-${suffix}` },
    ]).returning({ id: schema.organizations.id });
    const [orgA, orgB] = organizations;
    if (!orgA || !orgB) throw new Error("Could not create organization fixtures");

    const phoneNumberId = `security-phone-${suffix}`;
    const attempt = (organizationId: string, marker: string) => saveVerifiedWhatsAppConnectionAtomic(db, {
      organizationId,
      phone: {
        id: phoneNumberId,
        displayPhoneNumber: "+15550001111",
        verifiedName: `Security ${marker}`,
        qualityRating: "GREEN",
        throughputMps: 80,
      },
      wabaId: `waba-${marker}-${suffix}`,
      businessId: `business-${marker}-${suffix}`,
      credential: {
        key: `org/${organizationId}/whatsapp/${phoneNumberId}/access-token`,
        ciphertext: `ciphertext-${marker}`,
        iv: `iv-${marker}`,
        authTag: `tag-${marker}`,
      },
    });

    try {
      const results = await Promise.allSettled([
        attempt(orgA.id, "A"),
        attempt(orgB.id, "B"),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
      const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      expect(rejected?.reason).toBeInstanceOf(WhatsAppConnectionConflictError);

      const rows = await db.select({
        organizationId: schema.whatsappPhoneNumbers.organizationId,
        credentialKey: schema.whatsappPhoneNumbers.credentialKey,
      }).from(schema.whatsappPhoneNumbers)
        .where(eq(schema.whatsappPhoneNumbers.phoneNumberId, phoneNumberId));
      expect(rows).toHaveLength(1);
      const row = rows[0];
      if (!row) throw new Error("Connection row was not persisted");
      expect(row.credentialKey).toContain(`org/${row.organizationId}/whatsapp/`);

      const credentials = await db.select({
        organizationId: schema.credentialSecrets.organizationId,
        key: schema.credentialSecrets.key,
      }).from(schema.credentialSecrets)
        .where(eq(schema.credentialSecrets.key, row.credentialKey));
      expect(credentials).toEqual([{ organizationId: row.organizationId, key: row.credentialKey }]);
    } finally {
      await db.delete(schema.organizations).where(eq(schema.organizations.id, orgA.id));
      await db.delete(schema.organizations).where(eq(schema.organizations.id, orgB.id));
      await database.client.end({ timeout: 5 });
    }
  });
});
