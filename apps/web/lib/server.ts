import { redisStorage } from "@better-auth/redis-storage";
import { Redis } from "ioredis";
import { createAppAuth } from "@wa/auth";
import { createDatabase } from "@wa/db";
import {
  createCampaignDispatchQueue,
  createContactImportQueue,
  createDataExportQueue,
  createDataLifecycleQueue,
  createSendQueue,
  createWebhookQueue,
} from "@wa/queue";
import { sendAuthEmail } from "@/lib/auth-email";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionalPositiveIntegerEnv(name: string): number | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

const database = createDatabase(requiredEnv("DATABASE_URL"));
export const db = database.db;
export const databaseClient = database.client;
const redisUrl = requiredEnv("REDIS_URL");
export const contactImportQueue = createContactImportQueue(redisUrl);
export const campaignDispatchQueue = createCampaignDispatchQueue(redisUrl);
export const sendQueue = createSendQueue(redisUrl);
export const webhookQueue = createWebhookQueue(redisUrl);
export const dataExportQueue = createDataExportQueue(redisUrl);
export const dataLifecycleQueue = createDataLifecycleQueue(redisUrl);

const globalForAuthRedis = globalThis as unknown as { authRedis?: Redis };
const authRedis = globalForAuthRedis.authRedis ?? new Redis(redisUrl, { maxRetriesPerRequest: 3 });
if (process.env.NODE_ENV !== "production") globalForAuthRedis.authRedis = authRedis;

const authUrl = requiredEnv("BETTER_AUTH_URL");
const appUrl = process.env.APP_URL ?? authUrl;

export const auth = createAppAuth({
  db,
  baseUrl: authUrl,
  secret: requiredEnv("BETTER_AUTH_SECRET"),
  trustedOrigins: [...new Set([appUrl, authUrl])],
  secureCookies: process.env.NODE_ENV === "production",
  secondaryStorage: redisStorage({ client: authRedis, keyPrefix: "wa:auth:" }),
  signInRateLimitMax: optionalPositiveIntegerEnv("AUTH_SIGNIN_RATE_LIMIT_MAX"),
  signUpRateLimitMax: optionalPositiveIntegerEnv("AUTH_SIGNUP_RATE_LIMIT_MAX"),
  sendEmail: sendAuthEmail,
});

export function getMetaServerConfig() {
  return {
    appId: requiredEnv("META_APP_ID"),
    appSecret: requiredEnv("META_APP_SECRET"),
    configId: requiredEnv("META_CONFIG_ID"),
    graphApiVersion: process.env.META_GRAPH_API_VERSION ?? "v26.0",
  };
}

export function getCredentialEncryptionKey(): string {
  return requiredEnv("CREDENTIAL_ENCRYPTION_KEY");
}

export function getR2ServerConfig() {
  return {
    accountId: requiredEnv("R2_ACCOUNT_ID"),
    accessKeyId: requiredEnv("R2_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnv("R2_SECRET_ACCESS_KEY"),
    bucket: requiredEnv("R2_BUCKET"),
  };
}
