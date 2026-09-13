import { describe, expect, test } from "bun:test";
import type { S3Client } from "@aws-sdk/client-s3";
import { deleteStoredPrefix } from "./index";

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
