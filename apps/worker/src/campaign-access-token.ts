import { and, eq } from "drizzle-orm";
import { decryptSecret } from "@wa/credentials";
import type { WorkerEnv } from "@wa/config";
import { createDatabase, schema } from "@wa/db";
import { workerKeyRing } from "./credential-rotation";

type Database = ReturnType<typeof createDatabase>["db"];
const TOKEN_CACHE_MS = 5 * 60_000;
const TOKEN_REVALIDATE_MS = 1_000;

type CachedToken = {
  value: string;
  expiresAt: number;
  revalidateAt: number;
  credentialUpdatedAt: number;
};

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
  const tokenCache = new Map<string, CachedToken>();

  const getAccessToken = async (organizationId: string, credentialKey: string): Promise<string> => {
    const cacheKey = `${organizationId}:${credentialKey}`;
    const now = Date.now();
    const cached = tokenCache.get(cacheKey);

    // Connection readiness is checked immediately before this loader on every
    // send. Revalidate the encrypted credential row at a short interval instead
    // of once per message so high-throughput campaigns do not turn credential
    // cache validation into a database bottleneck.
    if (cached && cached.expiresAt > now && cached.revalidateAt > now) {
      return cached.value;
    }

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
      tokenCache.delete(cacheKey);
      throw new CredentialUnavailableError(
        "credential_missing",
        "The Meta credential is missing. Reconnect WhatsApp to resume sending.",
      );
    }

    const credentialUpdatedAt = secret.updatedAt.getTime();
    if (
      cached &&
      cached.expiresAt > now &&
      cached.credentialUpdatedAt === credentialUpdatedAt
    ) {
      cached.revalidateAt = now + TOKEN_REVALIDATE_MS;
      return cached.value;
    }

    let value: string;
    try {
      value = decryptSecret(secret, workerKeyRing(env));
    } catch {
      tokenCache.delete(cacheKey);
      throw new CredentialUnavailableError(
        "credential_unreadable",
        "The Meta credential cannot be read. Reconnect WhatsApp to resume sending.",
      );
    }

    tokenCache.set(cacheKey, {
      value,
      expiresAt: now + TOKEN_CACHE_MS,
      revalidateAt: now + TOKEN_REVALIDATE_MS,
      credentialUpdatedAt,
    });
    return value;
  };

  return getAccessToken;
}
