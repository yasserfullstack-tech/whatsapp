import { randomBytes } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_KEY_VERSION,
  createKeyRing,
  decryptSecret,
  encryptSecret,
  inspectStoredKeyVersions,
  rotateSecret,
  rotateStoredSecrets,
  summarizeKeyVersions,
  type EncryptedSecret,
  type StoredSecret,
} from "./index";

function key(): string {
  return randomBytes(32).toString("base64");
}

describe("versioned credential encryption", () => {
  test("round-trips a secret and records the current key version", () => {
    const ring = createKeyRing({ currentKey: key(), currentVersion: 3 });
    const encrypted = encryptSecret("meta-access-token", ring);

    expect(encrypted.ciphertext).not.toContain("meta-access-token");
    expect(encrypted.keyVersion).toBe(3);
    expect(decryptSecret(encrypted, ring)).toBe("meta-access-token");
  });

  test("still accepts a bare key string and defaults it to version 1", () => {
    const encryptionKey = key();
    const encrypted = encryptSecret("meta-access-token", encryptionKey);

    expect(encrypted.keyVersion).toBe(DEFAULT_KEY_VERSION);
    expect(decryptSecret(encrypted, encryptionKey)).toBe("meta-access-token");
  });

  test("fails decryption with the wrong key instead of returning corrupted plaintext", () => {
    const ring = createKeyRing({ currentKey: key(), currentVersion: 1 });
    const encrypted = encryptSecret("meta-access-token", ring);
    const wrongRing = createKeyRing({ currentKey: key(), currentVersion: 1 });

    expect(() => decryptSecret(encrypted, wrongRing)).toThrow();
  });

  test("reads a row written under v1 while the ring has advanced to v2", () => {
    const v1 = key();
    const v2 = key();
    const writtenUnderV1 = encryptSecret("meta-access-token", createKeyRing({ currentKey: v1, currentVersion: 1 }));
    expect(writtenUnderV1.keyVersion).toBe(1);

    const rotatingRing = createKeyRing({ currentKey: v2, currentVersion: 2, previousKey: v1 });
    expect(decryptSecret(writtenUnderV1, rotatingRing)).toBe("meta-access-token");
  });

  test("selects the key that matches the stored version", () => {
    const v1 = key();
    const v2 = key();
    const ring = createKeyRing({ currentKey: v2, currentVersion: 2, previousKey: v1 });

    const underV1 = encryptSecret("token-one", createKeyRing({ currentKey: v1, currentVersion: 1 }));
    const underV2 = encryptSecret("token-two", ring);
    expect(decryptSecret(underV1, ring)).toBe("token-one");
    expect(decryptSecret(underV2, ring)).toBe("token-two");

    // Mislabeling the stored version selects the wrong key and fails closed.
    expect(() => decryptSecret({ ...underV1, keyVersion: 2 }, ring)).toThrow();
    expect(() => decryptSecret({ ...underV2, keyVersion: 1 }, ring)).toThrow();
  });

  test("treats a missing stored version as version 1", () => {
    const v1 = key();
    const v2 = key();
    const legacyRow: EncryptedSecret = encryptSecret("meta-access-token", v1);
    const legacyWithoutVersion: EncryptedSecret = {
      ciphertext: legacyRow.ciphertext,
      iv: legacyRow.iv,
      authTag: legacyRow.authTag,
      keyVersion: null,
    };

    const rotatingRing = createKeyRing({ currentKey: v2, currentVersion: 2, previousKey: v1 });
    expect(decryptSecret(legacyWithoutVersion, rotatingRing)).toBe("meta-access-token");
  });

  test("fails closed when a ciphertext version has no configured key", () => {
    const secret: EncryptedSecret = { ...encryptSecret("meta-access-token", key()), keyVersion: 7 };
    const ring = createKeyRing({ currentKey: key(), currentVersion: 2, previousKey: key() });

    expect(() => decryptSecret(secret, ring)).toThrow("No credential encryption key configured for version 7");
  });

  test("rotateSecret re-encrypts under the current version and is idempotent", () => {
    const v1 = key();
    const v2 = key();
    const ring = createKeyRing({ currentKey: v2, currentVersion: 2, previousKey: v1 });
    const before: EncryptedSecret = encryptSecret("meta-access-token", v1);

    const rotated = rotateSecret(before, ring);
    expect(rotated).toMatchObject({ rotated: true, fromVersion: 1, toVersion: 2 });
    expect(rotated.secret.keyVersion).toBe(2);
    expect(decryptSecret(rotated.secret, ring)).toBe("meta-access-token");
    expect(() => decryptSecret(rotated.secret, createKeyRing({ currentKey: v1, currentVersion: 1 }))).toThrow();

    const again = rotateSecret(rotated.secret, ring);
    expect(again.rotated).toBe(false);
    expect(again.secret).toBe(rotated.secret);
  });

  test("rotateStoredSecrets leaves every row readable with only the current key", async () => {
    const v1 = key();
    const v2 = key();
    const ring = createKeyRing({ currentKey: v2, currentVersion: 2, previousKey: v1 });

    const plaintexts = ["token-a", "token-b", "token-c"];
    const rows = new Map<string, StoredSecret>(
      plaintexts.map((plaintext, index) => {
        const id = `row-${index}`;
        return [id, { id, secret: encryptSecret(plaintext, v1) }];
      }),
    );
    // A legacy row that never recorded a version.
    const legacy = encryptSecret("token-legacy", v1);
    rows.set("row-legacy", {
      id: "row-legacy",
      secret: { ciphertext: legacy.ciphertext, iv: legacy.iv, authTag: legacy.authTag, keyVersion: null },
    });

    const store = {
      listSecrets: async () => [...rows.values()],
      updateSecret: async (id: string, secret: EncryptedSecret) => {
        rows.set(id, { id, secret });
      },
    };

    const summary = await rotateStoredSecrets(store, ring);
    expect(summary).toEqual({ scanned: 4, rotated: 4, skipped: 0 });

    const currentOnly = createKeyRing({ currentKey: v2, currentVersion: 2 });
    for (const [id, expected] of [["row-0", "token-a"], ["row-1", "token-b"], ["row-2", "token-c"], ["row-legacy", "token-legacy"]] as const) {
      const stored = rows.get(id);
      expect(stored?.secret.keyVersion).toBe(2);
      expect(decryptSecret(stored!.secret, currentOnly)).toBe(expected);
    }

    // Re-running the rotation is a no-op.
    expect(await rotateStoredSecrets(store, ring)).toEqual({ scanned: 4, rotated: 0, skipped: 4 });
  });

  test("validates the key ring configuration", () => {
    expect(() => createKeyRing({ currentKey: Buffer.from("too-short").toString("base64") })).toThrow(
      "CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes",
    );
    expect(() => createKeyRing({ currentKey: key(), currentVersion: 0 })).toThrow(
      "CREDENTIAL_ENCRYPTION_KEY_VERSION must be a positive integer",
    );
    expect(() => createKeyRing({ currentKey: key(), currentVersion: 2, previousKey: key(), previousVersion: 2 })).toThrow(
      "CREDENTIAL_ENCRYPTION_KEY_PREVIOUS must use a different version than CREDENTIAL_ENCRYPTION_KEY",
    );
    expect(() => createKeyRing({ currentKey: key(), currentVersion: 1, previousKey: key() })).toThrow(
      "CREDENTIAL_ENCRYPTION_KEY_PREVIOUS requires CREDENTIAL_ENCRYPTION_KEY_VERSION greater than 1",
    );
    expect(() => createKeyRing({ currentKey: key(), currentVersion: 2, previousKey: "not-32-bytes" })).toThrow(
      "CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes",
    );
  });
});

describe("credential key version reporting", () => {
  function secretAt(version: number, keyMaterial: string, plaintext: string): EncryptedSecret {
    return encryptSecret(plaintext, createKeyRing({ currentKey: keyMaterial, currentVersion: version }));
  }

  test("counts rows per key version and reports the predecessor as referenced", () => {
    const v1 = key();
    const v2 = key();
    const legacy: EncryptedSecret = { ...secretAt(1, v1, "legacy"), keyVersion: null };

    const summary = summarizeKeyVersions([secretAt(2, v2, "current"), secretAt(1, v1, "old"), legacy], 2, 1);

    expect(summary.total).toBe(3);
    expect(summary.outdated).toBe(2);
    expect(summary.referencingPreviousKey).toBe(2);
    expect(summary.byVersion).toEqual([
      { version: 1, count: 2 },
      { version: 2, count: 1 },
    ]);
    expect(summary.safeToRetirePreviousKey).toBe(false);
  });

  test("does not count rows already at the current version as referencing the predecessor", () => {
    const v1 = key();
    const v2 = key();
    const summary = summarizeKeyVersions([secretAt(2, v2, "a"), secretAt(2, v2, "b")], 2, 1);

    expect(summary.total).toBe(2);
    expect(summary.outdated).toBe(0);
    expect(summary.referencingPreviousKey).toBe(0);
    expect(summary.byVersion).toEqual([{ version: 2, count: 2 }]);
    expect(summary.safeToRetirePreviousKey).toBe(true);
  });

  test("flips to safe once every row has been rotated", async () => {
    const v1 = key();
    const v2 = key();
    const ring = createKeyRing({ currentKey: v2, currentVersion: 2, previousKey: v1 });
    const rows = new Map<string, StoredSecret>([
      ["row-old", { id: "row-old", secret: secretAt(1, v1, "old") }],
      [
        "row-legacy",
        {
          id: "row-legacy",
          secret: { ...secretAt(1, v1, "legacy"), keyVersion: null } satisfies EncryptedSecret,
        },
      ],
    ]);
    const store = {
      listSecrets: async () => [...rows.values()],
      updateSecret: async (id: string, secret: EncryptedSecret) => {
        rows.set(id, { id, secret });
      },
    };

    const before = await inspectStoredKeyVersions(store, 2, 1);
    expect(before.outdated).toBe(2);
    expect(before.referencingPreviousKey).toBe(2);
    expect(before.safeToRetirePreviousKey).toBe(false);

    await rotateStoredSecrets(store, ring);

    const after = await inspectStoredKeyVersions(store, 2, 1);
    expect(after.outdated).toBe(0);
    expect(after.referencingPreviousKey).toBe(0);
    expect(after.byVersion).toEqual([{ version: 2, count: 2 }]);
    expect(after.safeToRetirePreviousKey).toBe(true);
  });

  test("reports no predecessor reference when the ring carries no previous key", () => {
    const v2 = key();
    const summary = summarizeKeyVersions([secretAt(2, v2, "current")], 2);

    expect(summary.previousVersion).toBeNull();
    expect(summary.referencingPreviousKey).toBe(0);
    expect(summary.safeToRetirePreviousKey).toBe(true);
  });

  test("treats a legacy row without a version as version 1", () => {
    const v1 = key();
    const legacy: EncryptedSecret = { ...secretAt(1, v1, "legacy"), keyVersion: null };

    const atV1 = summarizeKeyVersions([legacy], DEFAULT_KEY_VERSION, 1);
    expect(atV1.outdated).toBe(0);
    expect(atV1.byVersion).toEqual([{ version: 1, count: 1 }]);
    expect(atV1.safeToRetirePreviousKey).toBe(true);

    const atV2 = summarizeKeyVersions([legacy], 2, 1);
    expect(atV2.outdated).toBe(1);
    expect(atV2.referencingPreviousKey).toBe(1);
    expect(atV2.safeToRetirePreviousKey).toBe(false);
  });
});
