import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { asc, eq } from "drizzle-orm";
import { loadWorkerEnv } from "@wa/config";
import { createKeyRing, decryptSecret, encryptSecret } from "@wa/credentials";
import { createDatabase, schema } from "@wa/db";
import {
  inspectWorkerCredentialKeyVersions,
  rotateWorkerCredentials,
  workerKeyRing,
} from "./credential-rotation";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for credential rotation integration tests");

type Database = ReturnType<typeof createDatabase>["db"];

function key(): string {
  return randomBytes(32).toString("base64");
}

function createRotatingEnv(currentKey: string, previousKey: string) {
  return loadWorkerEnv({
    DATABASE_URL: databaseUrl,
    CREDENTIAL_ENCRYPTION_KEY: currentKey,
    CREDENTIAL_ENCRYPTION_KEY_VERSION: "2",
    CREDENTIAL_ENCRYPTION_KEY_PREVIOUS: previousKey,
    R2_ACCOUNT_ID: "test-account",
    R2_ACCESS_KEY_ID: "test-access-key",
    R2_SECRET_ACCESS_KEY: "test-secret",
    R2_BUCKET: "test-bucket",
  });
}

function encryptAt(plaintext: string, keyMaterial: string, version: number) {
  return encryptSecret(plaintext, createKeyRing({ currentKey: keyMaterial, currentVersion: version }));
}

async function createFixtureOrganization(db: Database, label: string) {
  const suffix = randomUUID();
  const [organization] = await db.insert(schema.organizations).values({
    name: `${label} ${suffix}`,
    slug: `${label}-${suffix}`,
  }).returning();
  if (!organization) throw new Error("Failed to create organization fixture");
  return organization;
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

describe("credential key version reporting", () => {
  test("counts rows still on the previous key and flips to safe after rotation", async () => {
    const database = createDatabase(databaseUrl);
    const db = database.db;
    const v1 = key();
    const v2 = key();
    const env = createRotatingEnv(v2, v1);
    const organization = await createFixtureOrganization(db, "credential-key-versions");

    try {
      const legacy = encryptAt("legacy", v1, 1);
      await db.insert(schema.credentialSecrets).values([
        {
          organizationId: organization.id,
          key: `org/${organization.id}/whatsapp/phone-0/access-token`,
          ciphertext: legacy.ciphertext,
          iv: legacy.iv,
          authTag: legacy.authTag,
          keyVersion: null,
        },
        {
          organizationId: organization.id,
          key: `org/${organization.id}/whatsapp/phone-1/access-token`,
          ...encryptAt("old", v1, 1),
        },
        {
          organizationId: organization.id,
          key: `org/${organization.id}/whatsapp/phone-2/access-token`,
          ...encryptAt("current", v2, 2),
        },
      ]);

      const before = await inspectWorkerCredentialKeyVersions(db, env, { organizationId: organization.id });
      expect(before.total).toBe(3);
      expect(before.outdated).toBe(2);
      expect(before.referencingPreviousKey).toBe(2);
      expect(before.previousVersion).toBe(1);
      expect(before.byVersion).toEqual([
        { version: 1, count: 2 },
        { version: 2, count: 1 },
      ]);
      expect(before.safeToRetirePreviousKey).toBe(false);

      expect(await rotateWorkerCredentials(db, env, { organizationId: organization.id }))
        .toEqual({ scanned: 3, rotated: 2, skipped: 1 });

      const after = await inspectWorkerCredentialKeyVersions(db, env, { organizationId: organization.id });
      expect(after.outdated).toBe(0);
      expect(after.referencingPreviousKey).toBe(0);
      expect(after.byVersion).toEqual([{ version: 2, count: 3 }]);
      expect(after.safeToRetirePreviousKey).toBe(true);
    } finally {
      await db.delete(schema.organizations).where(eq(schema.organizations.id, organization.id));
      await database.client.end({ timeout: 5 });
    }
  });
});

describe("credential rotation atomicity", () => {
  test("rolls back the whole batch when a locked row cannot be re-encrypted", async () => {
    const database = createDatabase(databaseUrl);
    const db = database.db;
    const v1 = key();
    const v2 = key();
    const env = createRotatingEnv(v2, v1);
    const organization = await createFixtureOrganization(db, "credential-rotation-rollback");

    try {
      // Encrypted under an unrelated key but labelled v1, so the ring cannot authenticate it.
      const undecryptable = encryptAt("bad", key(), 1);
      await db.insert(schema.credentialSecrets).values([
        {
          // Sorts before the undecryptable row, so it is re-encrypted first.
          id: "00000000-0000-0000-0000-0000000000b1",
          organizationId: organization.id,
          key: `org/${organization.id}/whatsapp/phone-0/access-token`,
          ...encryptAt("good", v1, 1),
        },
        {
          id: "00000000-0000-0000-0000-0000000000b2",
          organizationId: organization.id,
          key: `org/${organization.id}/whatsapp/phone-1/access-token`,
          ...undecryptable,
        },
      ]);

      await expect(rotateWorkerCredentials(db, env, { organizationId: organization.id })).rejects.toThrow();

      const rows = await db
        .select({ keyVersion: schema.credentialSecrets.keyVersion })
        .from(schema.credentialSecrets)
        .where(eq(schema.credentialSecrets.organizationId, organization.id))
        .orderBy(asc(schema.credentialSecrets.id));
      // Without the transaction the first row's rewrite would already be committed.
      expect(rows.map((row) => row.keyVersion)).toEqual([1, 1]);

      const report = await inspectWorkerCredentialKeyVersions(db, env, { organizationId: organization.id });
      expect(report.outdated).toBe(2);
      expect(report.safeToRetirePreviousKey).toBe(false);
    } finally {
      await db.delete(schema.organizations).where(eq(schema.organizations.id, organization.id));
      await database.client.end({ timeout: 5 });
    }
  });

  test("a concurrent rotation waits on the row lock instead of interleaving", async () => {
    const database = createDatabase(databaseUrl);
    const db = database.db;
    const v1 = key();
    const v2 = key();
    const env = createRotatingEnv(v2, v1);
    const organization = await createFixtureOrganization(db, "credential-rotation-lock");

    let releaseHolder = () => {};
    const holderGate = new Promise<void>((resolve) => {
      releaseHolder = resolve;
    });
    let signalLocked = () => {};
    const locked = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });
    let holder: Promise<unknown> | undefined;
    let rotation: Promise<unknown> | undefined;

    try {
      await db.insert(schema.credentialSecrets).values({
        organizationId: organization.id,
        key: `org/${organization.id}/whatsapp/phone-0/access-token`,
        ...encryptAt("locked", v1, 1),
      });

      holder = db.transaction(async (tx) => {
        await tx
          .select({ id: schema.credentialSecrets.id })
          .from(schema.credentialSecrets)
          .where(eq(schema.credentialSecrets.organizationId, organization.id))
          .for("update");
        signalLocked();
        await holderGate;
      });

      await locked;
      rotation = rotateWorkerCredentials(db, env, { organizationId: organization.id });
      const outcome = await Promise.race([
        rotation.then(() => "completed" as const, () => "failed" as const),
        new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 250)),
      ]);
      releaseHolder();
      await holder;
      const summary = await rotation;

      expect(outcome).toBe("blocked");
      expect(summary).toEqual({ scanned: 1, rotated: 1, skipped: 0 });
    } finally {
      releaseHolder();
      await holder?.catch(() => {});
      await rotation?.catch(() => {});
      await db.delete(schema.organizations).where(eq(schema.organizations.id, organization.id));
      await database.client.end({ timeout: 5 });
    }
  });
});
