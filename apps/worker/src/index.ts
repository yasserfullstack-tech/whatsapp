import { Worker } from "bullmq";
import { loadWorkerEnv } from "@wa/config";
import { WhatsAppCloudClient } from "@wa/meta";
import {
  PerNumberRateLimiter,
  SEND_QUEUE_NAME,
  WEBHOOK_QUEUE_NAME,
  createBullConnection,
  createRedisClient,
  type SendMessageJob,
} from "@wa/queue";

const env = loadWorkerEnv();
const redis = createRedisClient(env.REDIS_URL);
const limiter = new PerNumberRateLimiter(redis);

await redis.connect();

const sendWorker = new Worker<SendMessageJob>(
  SEND_QUEUE_NAME,
  async (job) => {
    const mps = Math.min(job.data.maxMessagesPerSecond ?? env.DEFAULT_META_MPS, 1_000);
    await limiter.acquire(job.data.phoneNumberId, Math.max(1, Math.floor(mps * 0.95)));

    if (!env.META_ACCESS_TOKEN) {
      throw new Error("META_ACCESS_TOKEN is not configured. Use a per-client secret provider in production.");
    }

    const client = new WhatsAppCloudClient({
      accessToken: env.META_ACCESS_TOKEN,
      graphApiVersion: env.META_GRAPH_API_VERSION,
    });

    return client.sendTemplate({
      phoneNumberId: job.data.phoneNumberId,
      to: job.data.to,
      templateName: job.data.templateName,
      languageCode: job.data.languageCode,
      components: job.data.components,
    });
  },
  {
    connection: createBullConnection(env.REDIS_URL),
    concurrency: env.WORKER_CONCURRENCY,
  },
);

const webhookWorker = new Worker(
  WEBHOOK_QUEUE_NAME,
  async (job) => {
    // Persist raw webhook payloads and apply status transitions in the next milestone.
    console.log("Received Meta webhook", { jobId: job.id });
  },
  {
    connection: createBullConnection(env.REDIS_URL),
    concurrency: 100,
  },
);

sendWorker.on("failed", (job, error) => {
  console.error("Send job failed", { jobId: job?.id, message: error.message });
});

webhookWorker.on("failed", (job, error) => {
  console.error("Webhook job failed", { jobId: job?.id, message: error.message });
});

console.log("Workers started", {
  sendConcurrency: env.WORKER_CONCURRENCY,
  defaultMps: env.DEFAULT_META_MPS,
});

const shutdown = async () => {
  await Promise.all([sendWorker.close(), webhookWorker.close()]);
  await redis.quit();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
