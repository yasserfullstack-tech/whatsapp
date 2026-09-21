import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Key version used for ciphertext that predates versioning. A stored secret with
 * no version (null/absent column) is read as this version, so existing rows keep
 * decrypting with the original key without any data migration.
 */
export const DEFAULT_KEY_VERSION = 1;

export type EncryptedSecret = {
  ciphertext: string;
  iv: string;
  authTag: string;
  /** Key version that produced the ciphertext. Absent/null means DEFAULT_KEY_VERSION. */
  keyVersion?: number | null;
};

export type CredentialKey = {
  version: number;
  key: string;
};

/**
 * The set of keys that may be used during a rotation window. `current` encrypts
 * new ciphertext; `previous` is retained only so existing ciphertext can still
 * be decrypted until it has been re-encrypted.
 */
export type EncryptionKeyRing = {
  current: CredentialKey;
  previous?: CredentialKey;
};

export type KeyRingInput = {
  currentKey: string;
  currentVersion?: number | undefined;
  previousKey?: string | undefined;
  previousVersion?: number | undefined;
};

export type StoredSecret = {
  id: string;
  secret: EncryptedSecret;
};

export type RotationStore = {
  listSecrets: () => Promise<StoredSecret[]>;
  updateSecret: (id: string, secret: EncryptedSecret) => Promise<void>;
};

export type RotationSummary = {
  scanned: number;
  rotated: number;
  skipped: number;
};

export type SecretRotation = {
  secret: EncryptedSecret;
  rotated: boolean;
  fromVersion: number;
  toVersion: number;
};

function decodeKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes");
  }
  return key;
}

function assertKeyVersion(version: number): void {
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY_VERSION must be a positive integer");
  }
}

/**
 * Builds a validated key ring. Keys are validated eagerly so a misconfigured
 * deployment fails at startup rather than on the first credential read.
 */
export function createKeyRing(input: KeyRingInput): EncryptionKeyRing {
  const currentVersion = input.currentVersion ?? DEFAULT_KEY_VERSION;
  assertKeyVersion(currentVersion);
  decodeKey(input.currentKey);

  const ring: EncryptionKeyRing = {
    current: { version: currentVersion, key: input.currentKey },
  };
  if (!input.previousKey) return ring;

  const previousVersion = input.previousVersion ?? currentVersion - 1;
  if (previousVersion === currentVersion) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY_PREVIOUS must use a different version than CREDENTIAL_ENCRYPTION_KEY");
  }
  if (previousVersion < 1) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY_PREVIOUS requires CREDENTIAL_ENCRYPTION_KEY_VERSION greater than 1");
  }
  decodeKey(input.previousKey);

  return { current: ring.current, previous: { version: previousVersion, key: input.previousKey } };
}

function selectKey(keys: string | EncryptionKeyRing, version: number): string {
  if (typeof keys === "string") {
    if (version !== DEFAULT_KEY_VERSION) {
      throw new Error(`No credential encryption key configured for version ${version}`);
    }
    return keys;
  }
  if (version === keys.current.version) return keys.current.key;
  if (keys.previous && version === keys.previous.version) return keys.previous.key;
  throw new Error(`No credential encryption key configured for version ${version}`);
}

export function encryptSecret(plaintext: string, keys: string | EncryptionKeyRing): EncryptedSecret {
  const version = typeof keys === "string" ? DEFAULT_KEY_VERSION : keys.current.version;
  const key = decodeKey(selectKey(keys, version));
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: version,
  };
}

export function decryptSecret(secret: EncryptedSecret, keys: string | EncryptionKeyRing): string {
  const version = secret.keyVersion ?? DEFAULT_KEY_VERSION;
  const key = decodeKey(selectKey(keys, version));
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(secret.iv, "base64"));
  decipher.setAuthTag(Buffer.from(secret.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Decrypts a secret with whichever key in the ring owns its stored version and
 * re-encrypts it with the current key. Secrets already at the current version
 * are returned untouched so the operation is idempotent.
 */
export function rotateSecret(secret: EncryptedSecret, ring: EncryptionKeyRing): SecretRotation {
  const fromVersion = secret.keyVersion ?? DEFAULT_KEY_VERSION;
  const toVersion = ring.current.version;
  if (fromVersion === toVersion) {
    return { secret, rotated: false, fromVersion, toVersion };
  }
  const plaintext = decryptSecret(secret, ring);
  return { secret: encryptSecret(plaintext, ring), rotated: true, fromVersion, toVersion };
}

/**
 * Re-encrypts every secret exposed by the store, leaving each one readable with
 * the current key. Intended to be run after the key ring has been widened to
 * include the previous key and before that key is retired.
 */
export async function rotateStoredSecrets(store: RotationStore, ring: EncryptionKeyRing): Promise<RotationSummary> {
  const stored = await store.listSecrets();
  let rotated = 0;
  for (const entry of stored) {
    const result = rotateSecret(entry.secret, ring);
    if (!result.rotated) continue;
    await store.updateSecret(entry.id, result.secret);
    rotated += 1;
  }
  return { scanned: stored.length, rotated, skipped: stored.length - rotated };
}
