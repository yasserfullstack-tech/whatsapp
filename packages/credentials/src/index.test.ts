import { randomBytes } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { decryptSecret, encryptSecret } from "./index";

function key(): string {
  return randomBytes(32).toString("base64");
}

describe("credential encryption", () => {
  test("round-trips a secret with AES-256-GCM", () => {
    const encryptionKey = key();
    const encrypted = encryptSecret("meta-access-token", encryptionKey);

    expect(encrypted.ciphertext).not.toContain("meta-access-token");
    expect(decryptSecret(encrypted, encryptionKey)).toBe("meta-access-token");
  });

  test("rejects the wrong key instead of returning corrupted plaintext", () => {
    const encrypted = encryptSecret("meta-access-token", key());
    expect(() => decryptSecret(encrypted, key())).toThrow();
  });

  test("exercises the documented decrypt-and-re-encrypt key rotation procedure", () => {
    const oldKey = key();
    const newKey = key();
    const beforeRotation = encryptSecret("meta-access-token", oldKey);

    const plaintext = decryptSecret(beforeRotation, oldKey);
    const afterRotation = encryptSecret(plaintext, newKey);

    expect(decryptSecret(afterRotation, newKey)).toBe("meta-access-token");
    expect(() => decryptSecret(afterRotation, oldKey)).toThrow();
    expect(() => decryptSecret(beforeRotation, newKey)).toThrow();
  });

  test("rejects encryption keys that are not exactly 32 decoded bytes", () => {
    expect(() => encryptSecret("secret", Buffer.from("too-short").toString("base64"))).toThrow(
      "CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes",
    );
  });
});
