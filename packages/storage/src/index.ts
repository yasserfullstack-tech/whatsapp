import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

export function createR2Client(config: R2Config): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

export async function createPresignedCsvUpload(input: {
  client: S3Client;
  bucket: string;
  key: string;
  expiresInSeconds?: number;
}): Promise<string> {
  return getSignedUrl(
    input.client,
    new PutObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
      ContentType: "text/csv",
    }),
    {
      expiresIn: input.expiresInSeconds ?? 900,
      signableHeaders: new Set(["content-type"]),
    },
  );
}

export async function headStoredObject(input: {
  client: S3Client;
  bucket: string;
  key: string;
}) {
  return input.client.send(new HeadObjectCommand({ Bucket: input.bucket, Key: input.key }));
}

export async function getStoredObject(input: {
  client: S3Client;
  bucket: string;
  key: string;
}) {
  return input.client.send(new GetObjectCommand({ Bucket: input.bucket, Key: input.key }));
}
