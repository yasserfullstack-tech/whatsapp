import { eq } from "drizzle-orm";
import { loadWorkerEnv, type WorkerEnv } from "@wa/config";
import {
  createKeyRing,
  rotateStoredSecrets,
  type EncryptedSecret,
  type EncryptionKeyRing,
  type RotationStore,
  type RotationSummary,
} from "@wa/credentials";
import { createDatabase, schema } from "@wa/db";

type Database = ReturnType<typeof createDatabase>["db"];

/**
 * Builds the credential key ring from worker configuration. `current` encrypts
 * new credentials; `CREDENTIAL_ENCRYPTION_KEY_PREVIOUS` is only present during a
 * rotation window so ciphertext written under the older key still decrypts.
 */
export function workerKeyRing(env: WorkerEnv): EncryptionKeyRing {
  return createKeyRing({
    currentKey: env.CREDENTIAL_ENCRYPTION_KEY,
    currentVersion: env.CREDENTIAL_ENCRYPTION_KEY_VERSION,
    previousKey: env.CREDENTIAL_ENCRYPTION_KEY_PREVIOUS,
  });
}

export function createCredentialRotationStore(
  db: Database,
  options: { organizationId?: string } = {},
): RotationStore {
  const organizationId = options.organizationId;
  return {
    async listSecrets() {
      const rows = await db
        .select({
          id: schema.credentialSecrets.id,
          ciphertext: schema.credentialSecrets.ciphertext,
          iv: schema.credentialSecrets.iv,
          authTag: schema.credentialSecrets.authTag,
          keyVersion: schema.credentialSecrets.keyVersion,
        })
        .from(schema.credentialSecrets)
        .where(organizationId ? eq(schema.credentialSecrets.organizationId, organizationId) : undefined);
      return rows.map((row) => ({
        id: row.id,
        secret: {
          ciphertext: row.ciphertext,
          iv: row.iv,
          authTag: row.authTag,
          keyVersion: row.keyVersion,
        } satisfies EncryptedSecret,
      }));
    },
    async updateSecret(id, secret) {
      await db
        .update(schema.credentialSecrets)
        .set({
          ciphertext: secret.ciphertext,
          iv: secret.iv,
          authTag: secret.authTag,
          keyVersion: secret.keyVersion ?? null,
          updatedAt: new Date(),
        })
        .where(eq(schema.credentialSecrets.id, id));
    },
  };
}

/**
 * Re-encrypts stored Meta credentials with the current key. Safe to re-run: rows
 * already at the current version are left untouched.
 */
export async function rotateWorkerCredentials(
  db: Database,
  env: WorkerEnv,
  options: { organizationId?: string } = {},
): Promise<RotationSummary> {
  return rotateStoredSecrets(createCredentialRotationStore(db, options), workerKeyRing(env));
}

if (import.meta.main) {
  const env = loadWorkerEnv();
  const database = createDatabase(env.DATABASE_URL);
  const organizationId = process.argv[2];
  try {
    const summary = await rotateWorkerCredentials(
      database.db,
      env,
      organizationId ? { organizationId } : {},
    );
    console.log("Credential rotation complete", summary);
  } finally {
    await database.client.end({ timeout: 5 });
  }
}
