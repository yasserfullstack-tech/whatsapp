import { describe, expect, test } from "bun:test";
import type { S3Client } from "@aws-sdk/client-s3";
import { deleteStoredPrefix, isObjectKeyWithinPrefix } from "./index";

function fakeS3(objects: Set<string>, ignoreDeletes = false): S3Client {
  return {
    async send(command: { constructor: { name: string }; input: { Prefix?: string; Key?: string } }) {
      if (command.constructor.name === "DeleteObjectCommand") {
        if (!ignoreDeletes && command.input.Key) objects.delete(command.input.Key);
        return {};
      }
      if (command.constructor.name === "ListObjectsV2Command") {
        const prefix = command.input.Prefix ?? "";
        const keys = [...objects].filter((key) => key.startsWith(prefix));
        return { Contents: keys.map((Key) => ({ Key })), IsTruncated: false, KeyCount: keys.length };
      }
      throw new Error(`Unexpected command ${command.constructor.name}`);
    },
  } as unknown as S3Client;
}

describe("R2 object key isolation", () => {
  test("accepts only objects strictly below the expected prefix", () => {
    const prefix = "org-a/data-exports/job-a/";
    expect(isObjectKeyWithinPrefix("org-a/data-exports/job-a/file.ndjson", prefix)).toBe(true);
    expect(isObjectKeyWithinPrefix("org-a/data-exports/job-a/nested/file.ndjson", prefix)).toBe(true);
    expect(isObjectKeyWithinPrefix(prefix, prefix)).toBe(false);
    expect(isObjectKeyWithinPrefix("org-b/data-exports/job-a/file.ndjson", prefix)).toBe(false);
    expect(isObjectKeyWithinPrefix("org-a2/data-exports/job-a/file.ndjson", prefix)).toBe(false);
    expect(isObjectKeyWithinPrefix("org-a/data-exports/job-b/file.ndjson", prefix)).toBe(false);
  });

  test("rejects path-like traversal, separator tricks, and control characters", () => {
    const prefix = "org-a/contact-imports/import-a/";
    for (const key of [
      "org-a/contact-imports/import-a/../foreign.csv",
      "org-a/contact-imports/import-a/./foreign.csv",
      "org-a/contact-imports/import-a//foreign.csv",
      "org-a/contact-imports/import-a\\foreign.csv",
      "/org-a/contact-imports/import-a/foreign.csv",
      "org-a/contact-imports/import-a/foreign\0.csv",
      "org-a/contact-imports/import-a/foreign\n.csv",
      "org-a/contact-imports/import-a/foreign\r.csv",
      "org-a/contact-imports/import-a/foreign\u007f.csv",
    ]) {
      expect(isObjectKeyWithinPrefix(key, prefix)).toBe(false);
    }
  });

  test("rejects malformed prefixes before applying containment checks", () => {
    const key = "org-a/data-exports/job-a/file.ndjson";
    for (const prefix of [
      "",
      "org-a/data-exports/job-a",
      "/org-a/data-exports/job-a/",
      "org-a/data-exports/../job-a/",
      "org-a/data-exports//job-a/",
      "org-a/data-exports/job-a\\",
      "org-a/data-exports/job-a\n/",
    ]) {
      expect(isObjectKeyWithinPrefix(key, prefix)).toBe(false);
    }
  });
});

describe("R2 tenant prefix cleanup", () => {
  test("deletes every tenant object and leaves other tenants untouched", async () => {
    const objects = new Set(["org-a/contact-imports/a.csv", "org-a/data-exports/job/file.ndjson", "org-b/keep.csv"]);
    const deleted = await deleteStoredPrefix({ client: fakeS3(objects), bucket: "test", prefix: "org-a/" });
    expect(deleted).toBe(2);
    expect([...objects]).toEqual(["org-b/keep.csv"]);
  });

  test("fails the purge if a tenant object remains after deletion attempts", async () => {
    const objects = new Set(["org-a/orphan.bin"]);
    await expect(deleteStoredPrefix({ client: fakeS3(objects, true), bucket: "test", prefix: "org-a/" }))
      .rejects.toThrow("R2 prefix cleanup incomplete for org-a/");
  });
});
