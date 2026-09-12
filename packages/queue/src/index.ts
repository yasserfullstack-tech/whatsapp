import { Queue } from "bullmq";
import { Redis } from "ioredis";
import type { TemplateComponent } from "@wa/meta";

export const SEND_QUEUE_NAME = "whatsapp-send";
export const WEBHOOK_QUEUE_NAME = "whatsapp-webhooks";

export type SendMessageJob = {
  organizationId: string;
  campaignId: string;
  recipientId: string;
  phoneNumberId: string;
  to: string;
  templateName: string;
  languageCode: string;
  components?: TemplateComponent[];
  maxMessagesPerSecond?: number;
};

export function createRedisClient(redisUrl: string): Redis {
  return new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
}

export function createBullConnection(redisUrl: string): Redis {
  return createRedisClient(redisUrl);
}

export function createSendQueue(redisUrl: string): Queue<SendMessageJob> {
  return new Queue<SendMessageJob>(SEND_QUEUE_NAME, {
    connection: createBullConnection(redisUrl),
    defaultJobOptions: {
      attempts: 6,
      backoff: { type: "exponential", delay: 1_000 },
      removeOnComplete: 5_000,
      removeOnFail: 20_000,
    },
  });
}

export function createWebhookQueue(redisUrl: string): Queue {
  return new Queue(WEBHOOK_QUEUE_NAME, {
    connection: createBullConnection(redisUrl),
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
      const result = (await this.redis.eval(
        TOKEN_BUCKET_SCRIPT,
        1,
        key,
        Date.now().toString(),
        refillPerMillisecond.toString(),
        capacity.toString(),
        "1",
      )) as [number, number];

      if (Number(result[0]) === 1) return;
      const waitMs = Math.max(1, Number(result[1]) || 1);
      await sleep(waitMs);
    }
  }
}
