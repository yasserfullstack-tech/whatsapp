import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type PutObjectCommandInput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type R2Config = { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string };

export function createR2Client(config: R2Config): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
}

export async function createPresignedCsvUpload(input: { client: S3Client; bucket: string; key: string; expiresInSeconds?: number }): Promise<string> {
  return getSignedUrl(input.client, new PutObjectCommand({ Bucket: input.bucket, Key: input.key, ContentType: "text/csv" }), {
    expiresIn: input.expiresInSeconds ?? 900,
    signableHeaders: new Set(["content-type"]),
  });
}

export async function createPresignedDownload(input: { client: S3Client; bucket: string; key: string; fileName?: string; expiresInSeconds?: number }): Promise<string> {
  return getSignedUrl(input.client, new GetObjectCommand({
    Bucket: input.bucket,
    Key: input.key,
    ResponseContentDisposition: input.fileName ? `attachment; filename="${input.fileName.replace(/["\r\n]/g, "-")}"` : undefined,
  }), { expiresIn: Math.max(60, Math.min(input.expiresInSeconds ?? 300, 900)) });
}

export async function putStoredObject(input: {
  client: S3Client;
  bucket: string;
  key: string;
  body: PutObjectCommandInput["Body"];
  contentType: string;
  contentLength?: number;
}) {
  return input.client.send(new PutObjectCommand({
    Bucket: input.bucket,
    Key: input.key,
    Body: input.body,
    ContentType: input.contentType,
    ContentLength: input.contentLength,
  }));
}

export async function deleteStoredObject(input: { client: S3Client; bucket: string; key: string }) {
  return input.client.send(new DeleteObjectCommand({ Bucket: input.bucket, Key: input.key }));
}

export async function deleteStoredPrefix(input: { client: S3Client; bucket: string; prefix: string }): Promise<number> {
  let deleted = 0;
  let continuationToken: string | undefined;
  do {
    const page = await input.client.send(new ListObjectsV2Command({ Bucket: input.bucket, Prefix: input.prefix, ContinuationToken: continuationToken, MaxKeys: 500 }));
    const keys = (page.Contents ?? []).flatMap((object) => object.Key ? [object.Key] : []);
    for (const key of keys) {
      await deleteStoredObject({ client: input.client, bucket: input.bucket, key });
      deleted += 1;
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  const remaining = await input.client.send(new ListObjectsV2Command({ Bucket: input.bucket, Prefix: input.prefix, MaxKeys: 1 }));
  if ((remaining.KeyCount ?? 0) > 0) throw new Error(`R2 prefix cleanup incomplete for ${input.prefix}`);
  return deleted;
}

export async function headStoredObject(input: { client: S3Client; bucket: string; key: string }) {
  return input.client.send(new HeadObjectCommand({ Bucket: input.bucket, Key: input.key }));
}

export async function getStoredObject(input: { client: S3Client; bucket: string; key: string }) {
  return input.client.send(new GetObjectCommand({ Bucket: input.bucket, Key: input.key }));
}
