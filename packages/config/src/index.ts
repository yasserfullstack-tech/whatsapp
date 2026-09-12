import { z } from "zod";

const base = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  REDIS_URL: z.url().default("redis://localhost:6379"),
  META_GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v26.0"),
});

const apiSchema = base.extend({
  API_PORT: z.coerce.number().int().positive().max(65_535).default(4000),
  META_VERIFY_TOKEN: z.string().min(8),
});

const workerSchema = base.extend({
  DATABASE_URL: z.string().min(1),
  CREDENTIAL_ENCRYPTION_KEY: z.string().min(1),
  META_ACCESS_TOKEN: z.string().optional(),
  DEFAULT_META_MPS: z.coerce.number().int().positive().max(1_000).default(80),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().max(4_000).default(800),
  CAMPAIGN_DISPATCH_CONCURRENCY: z.coerce.number().int().positive().max(128).default(16),
  CONTACT_IMPORT_CONCURRENCY: z.coerce.number().int().positive().max(16).default(2),
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),
});

export type ApiEnv = z.infer<typeof apiSchema>;
export type WorkerEnv = z.infer<typeof workerSchema>;

export function loadApiEnv(source: Record<string, string | undefined> = process.env): ApiEnv {
  return apiSchema.parse(source);
}

export function loadWorkerEnv(source: Record<string, string | undefined> = process.env): WorkerEnv {
  return workerSchema.parse(source);
}
