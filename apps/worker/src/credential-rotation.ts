import { and, asc, count, eq, sql } from "drizzle-orm";
import { loadWorkerEnv, type WorkerEnv } from "@wa/config";
import {
  DEFAULT_KEY_VERSION,
  createKeyRing,
  inspectStoredKeyVersions,
  rotateStoredSecrets,
  type EncryptedSecret,
  type EncryptionKeyRing,
  type KeyVersionSummary,
  type RotationStore,
  type RotationSummary,
  type SecretVersionStore,
  type StoredSecret,
} from "@wa/credentials";
import { createDatabase, schema } from "@wa/db";

type Database = ReturnType<typeof createDatabase>["db"];

/**
 * The slice of the database client the rotation store needs. Both the pooled
 * client and a transaction satisfy it, so the same store can run directly or
 * inside `db.transaction`.
 */
type CredentialDatabase = Pick<Database, "select" | "update">;

/**
 * Rows re-encrypted inside a single transaction. Each batch commits atomically
 * under row locks while the run as a whole stays resumable. Bounded so a large
 * table never holds row locks (or one long transaction) for the entire rotation.
 */
export const CREDENTIAL_ROTATION_BATCH_SIZE = 200;

type CredentialSecretRow = {
  id: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number | null;
};

const secretColumns = {
  id: schema.credentialSecrets.id,
  ciphertext: schema.credentialSecrets.ciphertext,
  iv: schema.credentialSecrets.iv,
  authTag: schema.credentialSecrets.authTag,
  keyVersion: schema.credentialSecrets.keyVersion,
};

function toStoredSecret(row: CredentialSecretRow): StoredSecret {
  return {
    id: row.id,
    secret: {
      ciphertext: row.ciphertext,
      iv: row.iv,
      authTag: row.authTag,
      keyVersion: row.keyVersion,
    } satisfies EncryptedSecret,
  };
}

async function updateStoredSecret(db: CredentialDatabase, id: string, secret: EncryptedSecret): Promise<void> {
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
}

function organizationScope(organizationId?: string) {
  return organizationId ? eq(schema.credentialSecrets.organizationId, organizationId) : undefined;
}

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

/**
 * Rotation store over a database handle. When the caller has already locked a
 * batch inside a transaction it passes those `rows`, so the store re-encrypts
 * exactly the rows it holds locks on instead of re-reading them.
 */
export function createCredentialRotationStore(
  db: CredentialDatabase,
  options: { organizationId?: string; rows?: readonly CredentialSecretRow[] } = {},
): RotationStore {
  const organizationId = options.organizationId;
  const lockedRows = options.rows;
  return {
    async listSecrets() {
      if (lockedRows) return lockedRows.map(toStoredSecret);
      const rows = await db
        .select(secretColumns)
        .from(schema.credentialSecrets)
        .where(organizationScope(organizationId));
      return rows.map(toStoredSecret);
    },
    async updateSecret(id, secret) {
      await updateStoredSecret(db, id, secret);
    },
  };
}

/**
 * Reports how many stored rows still sit at a key version other than the active
 * one, grouped by version, and whether the predecessor key is safe to retire.
 */
export async function inspectWorkerCredentialKeyVersions(
  db: Database,
  env: WorkerEnv,
  options: { organizationId?: string } = {},
): Promise<KeyVersionSummary> {
  const ring = workerKeyRing(env);
  const store: SecretVersionStore = createCredentialRotationStore(db, options);
  return inspectStoredKeyVersions(store, ring.current.version, ring.previous?.version);
}

/**
 * Locks up to `batchSize` rows that are not yet at the current version. Ordered
 * by id so concurrent rotations take locks in the same order and cannot
 * deadlock. A row with no recorded version reads as version 1, so the
 * comparison coalesces before checking.
 */
async function lockRotationBatch(
  tx: CredentialDatabase,
  currentVersion: number,
  batchSize: number,
  organizationId?: string,
): Promise<CredentialSecretRow[]> {
  return tx
    .select(secretColumns)
    .from(schema.credentialSecrets)
    .where(
      and(
        sql`coalesce(${schema.credentialSecrets.keyVersion}, ${DEFAULT_KEY_VERSION}) is distinct from ${currentVersion}`,
        organizationScope(organizationId),
      ),
    )
    .orderBy(asc(schema.credentialSecrets.id))
    .limit(batchSize)
    .for("update");
}

/**
 * Re-encrypts stored Meta credentials with the current key in bounded,
 * row-locked transactions. Each batch is atomic: it either commits every row it
 * locked or, on failure, rolls back and leaves the table untouched. The run as a
 * whole is resumable — re-running skips rows already at the current version — so
 * an interrupted run leaves every committed batch rotated and the rest readable
 * with the previous key.
 */
export async function rotateWorkerCredentials(
  db: Database,
  env: WorkerEnv,
  options: { organizationId?: string; batchSize?: number } = {},
): Promise<RotationSummary> {
  const ring = workerKeyRing(env);
  const batchSize = options.batchSize ?? CREDENTIAL_ROTATION_BATCH_SIZE;
  const organizationId = options.organizationId;

  const [counted] = await db
    .select({ total: count() })
    .from(schema.credentialSecrets)
    .where(organizationScope(organizationId));
  const scanned = counted?.total ?? 0;

  let rotated = 0;
  for (;;) {
    const rotatedInBatch = await db.transaction(async (tx) => {
      const rows = await lockRotationBatch(tx, ring.current.version, batchSize, organizationId);
      if (rows.length === 0) return 0;
      const store = createCredentialRotationStore(tx, {
        ...(organizationId ? { organizationId } : {}),
        rows,
      });
      const summary = await rotateStoredSecrets(store, ring);
      return summary.rotated;
    });
    if (rotatedInBatch === 0) break;
    rotated += rotatedInBatch;
  }

  return { scanned, rotated, skipped: scanned - rotated };
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
