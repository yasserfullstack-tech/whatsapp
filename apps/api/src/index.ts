import { createHash } from "node:crypto";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { eq } from "drizzle-orm";
import { loadApiEnv } from "@wa/config";
import { createDatabase, schema } from "@wa/db";
import { parseWhatsAppWebhook } from "@wa/meta/webhooks";
import { createWebhookQueue } from "@wa/queue";
import { z } from "zod";
import { verifyMetaWebhookSignature } from "./webhook-signature";

const env = loadApiEnv();
const app = new Hono();
const database = createDatabase(env.DATABASE_URL);
const db = database.db;
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
  const rawBody = await c.req.text();
  const signature = c.req.header("x-hub-signature-256");

  if (!verifyMetaWebhookSignature(rawBody, signature, env.META_APP_SECRET)) {
    return c.text("Invalid webhook signature", 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  if (!payload || typeof payload !== "object" || (payload as Record<string, unknown>).object !== "whatsapp_business_account") {
    return c.json({ error: "Unsupported webhook object" }, 400);
  }

  const parsed = parseWhatsAppWebhook(payload);
  const eventKey = `sha256:${createHash("sha256").update(rawBody, "utf8").digest("hex")}`;

  const [inserted] = await db
    .insert(schema.webhookEvents)
    .values({
      eventKey,
      phoneNumberId: parsed.phoneNumberIds[0] ?? null,
      payload,
    })
    .onConflictDoNothing({ target: schema.webhookEvents.eventKey })
    .returning({ id: schema.webhookEvents.id, processedAt: schema.webhookEvents.processedAt });

  const event = inserted ?? (
    await db
      .select({ id: schema.webhookEvents.id, processedAt: schema.webhookEvents.processedAt })
      .from(schema.webhookEvents)
      .where(eq(schema.webhookEvents.eventKey, eventKey))
      .limit(1)
  )[0];

  if (!event) return c.json({ error: "Could not persist webhook" }, 500);

  if (!event.processedAt) {
    try {
      await webhookQueue.add(
        "process-meta-webhook",
        { eventId: event.id },
        { jobId: `webhook-${event.id}` },
      );
    } catch (error) {
      console.error("Could not queue persisted Meta webhook", { eventId: event.id, error });
      return c.json({ error: "Webhook persisted but processing is temporarily unavailable" }, 503);
    }
  }

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
