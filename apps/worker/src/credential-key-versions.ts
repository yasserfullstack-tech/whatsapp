import { loadWorkerEnv } from "@wa/config";
import { createDatabase } from "@wa/db";
import { inspectWorkerCredentialKeyVersions } from "./credential-rotation";

/**
 * Operator check for the end of a credential-encryption rotation window: reports
 * how many `credential_secrets` rows still reference a key version other than
 * the active one, grouped by version, and whether the predecessor key is safe
 * to retire. Exits non-zero while any row still references an older version, so
 * it can gate the removal of `CREDENTIAL_ENCRYPTION_KEY_PREVIOUS`.
 */
if (import.meta.main) {
  const env = loadWorkerEnv();
  const database = createDatabase(env.DATABASE_URL);
  const organizationId = process.argv[2];
  try {
    const summary = await inspectWorkerCredentialKeyVersions(
      database.db,
      env,
      organizationId ? { organizationId } : {},
    );
    console.log("Credential key version report", summary);
    console.log(
      summary.safeToRetirePreviousKey
        ? "Safe to retire CREDENTIAL_ENCRYPTION_KEY_PREVIOUS: no stored row references an older key version."
        : `Not safe to retire CREDENTIAL_ENCRYPTION_KEY_PREVIOUS: ${summary.outdated} stored row(s) still reference an older key version.`,
    );
    if (!summary.safeToRetirePreviousKey) process.exitCode = 1;
  } finally {
    await database.client.end({ timeout: 5 });
  }
}
