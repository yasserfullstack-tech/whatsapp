import { z } from "zod";

const baseShape = {
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  REDIS_URL: z.url().default("redis://localhost:6379"),
  META_GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v26.0"),
} as const;

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost"
    || normalized.endsWith(".localhost")
    || normalized === "127.0.0.1"
    || normalized === "::1"
    || normalized === "[::1]";
}

function validateProductionRedis(
  value: { NODE_ENV: "development" | "test" | "production"; REDIS_URL: string },
  ctx: z.RefinementCtx,
) {
  if (value.NODE_ENV !== "production") return;
  const hostname = new URL(value.REDIS_URL).hostname;
  if (isLoopbackHostname(hostname)) {
    ctx.addIssue({
      code: "custom",
      path: ["REDIS_URL"],
      message: "REDIS_URL must point to the production Valkey/Redis service",
    });
  }
}

const apiSchema = z.object({
  ...baseShape,
  API_PORT: z.coerce.number().int().positive().max(65_535).default(4000),
  DATABASE_URL: z.string().min(1),
  META_APP_SECRET: z.string().min(1),
  META_VERIFY_TOKEN: z.string().min(8),
}).superRefine(validateProductionRedis);

const workerSchema = z.object({
  ...baseShape,
  DATABASE_URL: z.string().min(1),
  CREDENTIAL_ENCRYPTION_KEY: z.string().min(1),
  APP_URL: z.url().optional(),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().max(65_535).optional(),
  SMTP_SECURITY: z.enum(["tls", "starttls"]).default("tls"),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(1).optional(),
  EMAIL_REPLY_TO: z.string().optional(),
  DEFAULT_META_MPS: z.coerce.number().int().positive().max(1_000).default(80),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().max(2_000).default(400),
  WEBHOOK_CONCURRENCY: z.coerce.number().int().positive().max(1_000).default(100),
  CAMPAIGN_DISPATCH_CONCURRENCY: z.coerce.number().int().positive().max(100).default(8),
  CONTACT_IMPORT_CONCURRENCY: z.coerce.number().int().positive().max(16).default(2),
  WORKER_METRICS_PORT: z.coerce.number().int().positive().max(65_535).default(9464),
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),
}).superRefine((value, ctx) => {
  validateProductionRedis(value, ctx);
  if (value.NODE_ENV !== "production") return;

  for (const name of ["APP_URL", "SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM"] as const) {
    if (!value[name]) {
      ctx.addIssue({
        code: "custom",
        path: [name],
        message: `${name} is required in production`,
      });
    }
  }

  if (value.APP_URL && isLoopbackHostname(new URL(value.APP_URL).hostname)) {
    ctx.addIssue({
      code: "custom",
      path: ["APP_URL"],
      message: "APP_URL must use the public production application origin",
    });
  }
});

export type ApiEnv = z.infer<typeof apiSchema>;
export type WorkerEnv = z.infer<typeof workerSchema>;

export function loadApiEnv(source: Record<string, string | undefined> = process.env): ApiEnv {
  return apiSchema.parse(source);
}

export function loadWorkerEnv(source: Record<string, string | undefined> = process.env): WorkerEnv {
  return workerSchema.parse(source);
}

// release-gate probe RED-2: throwaway comment so the infra gate is applicable
