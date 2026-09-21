import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { asc, eq } from "drizzle-orm";
import { loadWorkerEnv } from "@wa/config";
import { createKeyRing, decryptSecret, encryptSecret } from "@wa/credentials";
import { createDatabase, schema } from "@wa/db";
import { rotateWorkerCredentials, workerKeyRing } from "./credential-rotation";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for credential rotation integration tests");

function key(): string {
  return randomBytes(32).toString("base64");
}

describe("credential key rotation", () => {
  test("re-encrypts every stored credential so the previous key can be retired", async () => {
    const database = createDatabase(databaseUrl);
    const db = database.db;
    const suffix = randomUUID();
    const v1 = key();
    const v2 = key();

    const rotatingEnv = loadWorkerEnv({
      DATABASE_URL: databaseUrl,
      CREDENTIAL_ENCRYPTION_KEY: v2,
      CREDENTIAL_ENCRYPTION_KEY_VERSION: "2",
      CREDENTIAL_ENCRYPTION_KEY_PREVIOUS: v1,
      R2_ACCOUNT_ID: "test-account",
      R2_ACCESS_KEY_ID: "test-access-key",
      R2_SECRET_ACCESS_KEY: "test-secret",
      R2_BUCKET: "test-bucket",
    });

    const [organization] = await db.insert(schema.organizations).values({
      name: `Credential rotation ${suffix}`,
      slug: `credential-rotation-${suffix}`,
    }).returning();
    if (!organization) throw new Error("Failed to create organization fixture");

    const plaintexts = ["token-one", "token-two", "token-three"];
    const selectSecret = () => db
      .select({
        ciphertext: schema.credentialSecrets.ciphertext,
        iv: schema.credentialSecrets.iv,
        authTag: schema.credentialSecrets.authTag,
        keyVersion: schema.credentialSecrets.keyVersion,
      })
      .from(schema.credentialSecrets)
      .where(eq(schema.credentialSecrets.organizationId, organization.id))
      .orderBy(asc(schema.credentialSecrets.key));

    try {
      // Rows written before versioning existed (no key_version) plus explicit v1 rows.
      for (const [index, plaintext] of plaintexts.entries()) {
        const encrypted = encryptSecret(plaintext, v1);
        await db.insert(schema.credentialSecrets).values({
          organizationId: organization.id,
          key: `org/${organization.id}/whatsapp/phone-${index}/access-token`,
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          keyVersion: index === 0 ? null : 1,
        });
      }

      const ring = workerKeyRing(rotatingEnv);
      const currentOnly = createKeyRing({ currentKey: v2, currentVersion: 2 });

      const before = await selectSecret();
      expect(before).toHaveLength(plaintexts.length);
      for (const [index, row] of before.entries()) {
        // The widened ring reads the legacy (null) and explicit v1 rows during the window.
        expect(decryptSecret(row, ring)).toBe(plaintexts[index]!);
        // Without the previous key those rows are not yet readable, so rotation is required.
        expect(() => decryptSecret(row, currentOnly)).toThrow();
      }

      const summary = await rotateWorkerCredentials(db, rotatingEnv, { organizationId: organization.id });
      expect(summary).toEqual({ scanned: plaintexts.length, rotated: plaintexts.length, skipped: 0 });

      const after = await selectSecret();
      for (const [index, row] of after.entries()) {
        expect(row.keyVersion).toBe(2);
        expect(decryptSecret(row, currentOnly)).toBe(plaintexts[index]!);
      }

      // Re-running the rotation is a no-op.
      expect(await rotateWorkerCredentials(db, rotatingEnv, { organizationId: organization.id }))
        .toEqual({ scanned: plaintexts.length, rotated: 0, skipped: plaintexts.length });
    } finally {
      await db.delete(schema.organizations).where(eq(schema.organizations.id, organization.id));
      await database.client.end({ timeout: 5 });
    }
  });
});
