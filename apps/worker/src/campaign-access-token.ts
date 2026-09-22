import { and, eq } from "drizzle-orm";
import { decryptSecret } from "@wa/credentials";
import type { WorkerEnv } from "@wa/config";
import { createDatabase, schema } from "@wa/db";
import { workerKeyRing } from "./credential-rotation";

type Database = ReturnType<typeof createDatabase>["db"];
const TOKEN_CACHE_MS = 5 * 60_000;

export class CredentialUnavailableError extends Error {
  constructor(
    readonly code: "credential_missing" | "credential_unreadable",
    readonly safeReason: string,
  ) {
    super(safeReason);
    this.name = "CredentialUnavailableError";
  }
}

export function createAccessTokenLoader(db: Database, env: WorkerEnv) {
  const tokenCache = new Map<string, { value: string; expiresAt: number; credentialUpdatedAt: number }>();
  const getAccessToken = async (organizationId: string, credentialKey: string): Promise<string> => {
    const cacheKey = `${organizationId}:${credentialKey}`;
    const [secret] = await db
      .select({
        ciphertext: schema.credentialSecrets.ciphertext,
        iv: schema.credentialSecrets.iv,
        authTag: schema.credentialSecrets.authTag,
        keyVersion: schema.credentialSecrets.keyVersion,
        updatedAt: schema.credentialSecrets.updatedAt,
      })
      .from(schema.credentialSecrets)
      .where(
        and(
          eq(schema.credentialSecrets.organizationId, organizationId),
          eq(schema.credentialSecrets.key, credentialKey),
        ),
      )
      .limit(1);

    if (!secret) {
      throw new CredentialUnavailableError(
        "credential_missing",
        "The Meta credential is missing. Reconnect WhatsApp to resume sending.",
      );
    }
    const credentialUpdatedAt = secret.updatedAt.getTime();
    const cached = tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() && cached.credentialUpdatedAt === credentialUpdatedAt) return cached.value;

    let value: string;
    try {
      value = decryptSecret(secret, workerKeyRing(env));
    } catch {
      throw new CredentialUnavailableError(
        "credential_unreadable",
        "The Meta credential cannot be read. Reconnect WhatsApp to resume sending.",
      );
    }
    tokenCache.set(cacheKey, { value, expiresAt: Date.now() + TOKEN_CACHE_MS, credentialUpdatedAt });
    return value;
  };
  return getAccessToken;
}
