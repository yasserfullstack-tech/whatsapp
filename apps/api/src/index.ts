import { Hono } from "hono";
import { logger } from "hono/logger";
import { loadApiEnv } from "@wa/config";
import { createWebhookQueue } from "@wa/queue";
import { z } from "zod";

const env = loadApiEnv();
const app = new Hono();
const webhookQueue = createWebhookQueue(env.REDIS_URL);

app.use(logger());

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "api",
    timestamp: new Date().toISOString(),
  }),
);

app.get("/api/v1/meta/webhook", (c) => {
  const mode = c.req.query("hub.mode");
  const token = c.req.query("hub.verify_token");
  const challenge = c.req.query("hub.challenge");

  if (mode === "subscribe" && token === env.META_VERIFY_TOKEN && challenge) {
    return c.text(challenge, 200);
  }

  return c.text("Forbidden", 403);
});

app.post("/api/v1/meta/webhook", async (c) => {
  const payload = await c.req.json<unknown>();

  await webhookQueue.add("meta-webhook", payload, {
    attempts: 8,
    backoff: { type: "exponential", delay: 1_000 },
    removeOnComplete: 2_000,
    removeOnFail: 10_000,
  });

  return c.json({ received: true }, 200);
});

const estimateSchema = z.object({
  recipients: z.number().int().positive().max(10_000_000),
  messagesPerSecond: z.number().int().positive().max(1_000),
});

app.post("/api/v1/campaigns/estimate", async (c) => {
  const parsed = estimateSchema.safeParse(await c.req.json<unknown>());
  if (!parsed.success) {
    return c.json({ error: "Invalid request", issues: parsed.error.issues }, 400);
  }

  const seconds = Math.ceil(parsed.data.recipients / parsed.data.messagesPerSecond);
  return c.json({
    recipients: parsed.data.recipients,
    messagesPerSecond: parsed.data.messagesPerSecond,
    estimatedSeconds: seconds,
  });
});

const server = Bun.serve({
  port: env.API_PORT,
  fetch: app.fetch,
});

console.log(`API listening on ${server.url}`);
