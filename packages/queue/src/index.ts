import { Queue } from "bullmq";
import { Redis } from "ioredis";
import type { TemplateComponent } from "@wa/meta";

export const SEND_QUEUE_NAME = "whatsapp-send";
export const WEBHOOK_QUEUE_NAME = "whatsapp-webhooks";
export const CONTACT_IMPORT_QUEUE_NAME = "contact-imports";
export const CAMPAIGN_DISPATCH_QUEUE_NAME = "campaign-dispatch";
export const DATA_EXPORT_QUEUE_NAME = "data-exports";
export const DATA_LIFECYCLE_QUEUE_NAME = "data-lifecycle";

export type CampaignVariableBinding = {
  index: number;
  source: "display_name" | "phone_e164" | "literal";
  value?: string;
  fallback?: string;
};

export type SendMessageJob = {
  organizationId: string;
  campaignId: string;
  recipientId: string;
  phoneNumberId: string;
  credentialKey: string;
  to: string;
  templateName: string;
  languageCode: string;
  components?: TemplateComponent[] | undefined;
  maxMessagesPerSecond?: number;
};

export type ContactImportJob = { organizationId: string; importId: string };
export type CampaignDispatchJob = { organizationId: string; campaignId: string };
export type WebhookProcessJob = { eventId: string };
export type DataExportJob = { organizationId: string; exportJobId: string };
export type DataLifecycleJob =
  | { type: "workspace-purge"; organizationId: string; deletionRequestId: string }
  | { type: "retention-cleanup"; organizationId?: string };

export function createRedisClient(redisUrl: string): Redis {
  return new Redis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: true, lazyConnect: true });
}

export function createBullConnection(redisUrl: string): Redis {
  return createRedisClient(redisUrl);
}

export function createSendQueue(redisUrl: string): Queue<SendMessageJob> {
  return new Queue<SendMessageJob>(SEND_QUEUE_NAME, {
    connection: createBullConnection(redisUrl),
    defaultJobOptions: { attempts: 6, backoff: { type: "exponential", delay: 1_000 }, removeOnComplete: 5_000, removeOnFail: 20_000 },
  });
}

export function createWebhookQueue(redisUrl: string): Queue<WebhookProcessJob> {
  return new Queue<WebhookProcessJob>(WEBHOOK_QUEUE_NAME, {
    connection: createBullConnection(redisUrl),
    defaultJobOptions: { attempts: 12, backoff: { type: "exponential", delay: 1_000 }, removeOnComplete: 10_000, removeOnFail: 50_000 },
  });
}

export function createContactImportQueue(redisUrl: string): Queue<ContactImportJob> {
  return new Queue<ContactImportJob>(CONTACT_IMPORT_QUEUE_NAME, {
    connection: createBullConnection(redisUrl),
    defaultJobOptions: { attempts: 4, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: 1_000, removeOnFail: 5_000 },
  });
}

export function createCampaignDispatchQueue(redisUrl: string): Queue<CampaignDispatchJob> {
  return new Queue<CampaignDispatchJob>(CAMPAIGN_DISPATCH_QUEUE_NAME, {
    connection: createBullConnection(redisUrl),
    defaultJobOptions: { attempts: 4, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: true, removeOnFail: true },
  });
}

export function createDataExportQueue(redisUrl: string): Queue<DataExportJob> {
  return new Queue<DataExportJob>(DATA_EXPORT_QUEUE_NAME, {
    connection: createBullConnection(redisUrl),
    defaultJobOptions: { attempts: 4, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: 5_000, removeOnFail: 10_000 },
  });
}

export function createDataLifecycleQueue(redisUrl: string): Queue<DataLifecycleJob> {
  return new Queue<DataLifecycleJob>(DATA_LIFECYCLE_QUEUE_NAME, {
    connection: createBullConnection(redisUrl),
    defaultJobOptions: { attempts: 6, backoff: { type: "exponential", delay: 10_000 }, removeOnComplete: 2_000, removeOnFail: 10_000 },
  });
}

const TOKEN_BUCKET_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local capacity = tonumber(ARGV[3])
local requested = tonumber(ARGV[4])
local state = redis.call('HMGET', key, 'tokens', 'timestamp')
local tokens = tonumber(state[1])
local timestamp = tonumber(state[2])
if tokens == nil then tokens = capacity end
if timestamp == nil then timestamp = now end
local elapsed = math.max(0, now - timestamp)
tokens = math.min(capacity, tokens + (elapsed * rate))
local allowed = 0
local wait_ms = 0
if tokens >= requested then
  tokens = tokens - requested
  allowed = 1
else
  wait_ms = math.ceil((requested - tokens) / rate)
end
redis.call('HSET', key, 'tokens', tokens, 'timestamp', now)
redis.call('PEXPIRE', key, math.ceil((capacity / rate) * 2))
return {allowed, wait_ms}
`;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class PerNumberRateLimiter {
  constructor(private readonly redis: Redis) {}

  async acquire(phoneNumberId: string, messagesPerSecond: number): Promise<void> {
    const safeMps = Math.max(1, Math.min(messagesPerSecond, 1_000));
    const capacity = Math.max(1, Math.ceil(safeMps * 0.1));
    const refillPerMillisecond = safeMps / 1_000;
    const key = `rate:whatsapp:${phoneNumberId}`;

    for (;;) {
      const result = (await this.redis.eval(TOKEN_BUCKET_SCRIPT, 1, key, Date.now().toString(), refillPerMillisecond.toString(), capacity.toString(), "1")) as [number, number];
      if (Number(result[0]) === 1) return;
      await sleep(Math.max(1, Number(result[1]) || 1));
    }
  }
}
