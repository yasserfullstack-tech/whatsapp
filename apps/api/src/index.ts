import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { loadApiEnv } from "@wa/config";
import { createDatabase, schema } from "@wa/db";
import { parseWhatsAppWebhook } from "@wa/meta/webhooks";
import { createLogger, MetricsRegistry } from "@wa/observability";
import { createRedisClient, createWebhookQueue } from "@wa/queue";
import { z } from "zod";
import {
  WebhookPersistenceError,
  WebhookQueueError,
  persistAndQueueWebhook,
} from "./webhook-inbox";
import { verifyMetaWebhookSignature } from "./webhook-signature";

const env = loadApiEnv();
const app = new Hono<{ Variables: { requestId: string } }>();
const database = createDatabase(env.DATABASE_URL);
const db = database.db;
const webhookQueue = createWebhookQueue(env.REDIS_URL);
const readinessRedis = createRedisClient(env.REDIS_URL);
const log = createLogger({ service: "api" });
const metrics = new MetricsRegistry();
let dbStatsWarningLogged = false;

metrics.defineCounter("whatsapp_http_requests_total", "HTTP requests handled by the API", ["method", "route", "status"]);
metrics.defineCounter("whatsapp_http_errors_total", "HTTP responses with status 4xx or 5xx", ["method", "route", "status"]);
metrics.defineHistogram("whatsapp_http_request_duration_seconds", "HTTP request latency in seconds", ["method", "route"]);
metrics.defineCounter("whatsapp_webhooks_received_total", "Meta webhook POST requests received");
metrics.defineCounter("whatsapp_webhook_errors_total", "Meta webhook requests rejected or unavailable", ["reason"]);
metrics.defineHistogram("whatsapp_readiness_check_duration_seconds", "Readiness dependency check latency in seconds", ["dependency"]);
metrics.defineCounter("whatsapp_db_queries_total", "Database statements executed as reported by pg_stat_statements", ["database"]);
metrics.defineCounter("whatsapp_db_query_exec_seconds_total", "Cumulative database statement execution time in seconds", ["database"]);
metrics.defineGauge("whatsapp_db_query_stats_available", "Whether pg_stat_statements statistics are available", ["database"]);

function metricRoute(path: string): string {
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,36}(?=\/|$)/gi, "/:id")
    .replace(/\/\d+(?=\/|$)/g, "/:id");
}

function safeRequestId(value: string | undefined): string {
  if (value && value.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(value)) return value;
  return randomUUID();
}

async function refreshDatabaseMetrics() {
  try {
    const [stats] = await database.client<[{ calls: number; total_seconds: number }]>`
      SELECT
        COALESCE(SUM(calls), 0)::double precision AS calls,
        COALESCE(SUM(total_exec_time), 0)::double precision / 1000 AS total_seconds
      FROM pg_stat_statements
      WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND query NOT ILIKE '%pg_stat_statements%'
    `;

    metrics.setCounter("whatsapp_db_queries_total", stats?.calls ?? 0, { database: "primary" });
    metrics.setCounter("whatsapp_db_query_exec_seconds_total", stats?.total_seconds ?? 0, { database: "primary" });
    metrics.setGauge("whatsapp_db_query_stats_available", 1, { database: "primary" });
    dbStatsWarningLogged = false;
  } catch (error) {
    metrics.setGauge("whatsapp_db_query_stats_available", 0, { database: "primary" });
    if (!dbStatsWarningLogged) {
      log.warn("db_query_stats_unavailable", { error });
      dbStatsWarningLogged = true;
    }
  }
}

app.use("*", async (c, next) => {
  const requestId = safeRequestId(c.req.header("x-request-id"));
  c.set("requestId", requestId);
  c.header("x-request-id", requestId);

  const startedAt = performance.now();
  let failed = false;

  try {
    await next();
  } catch (error) {
    failed = true;
    log.error("http_request_unhandled_error", {
      requestId,
      method: c.req.method,
      route: metricRoute(c.req.path),
      error,
    });
    throw error;
  } finally {
    const route = metricRoute(c.req.path);
    const status = failed ? 500 : c.res.status;
    const durationSeconds = (performance.now() - startedAt) / 1_000;
    const labels = { method: c.req.method, route, status: String(status) };

    metrics.incCounter("whatsapp_http_requests_total", labels);
    metrics.observeHistogram("whatsapp_http_request_duration_seconds", durationSeconds, {
      method: c.req.method,
      route,
    });
    if (status >= 400) metrics.incCounter("whatsapp_http_errors_total", labels);

    log.info("http_request_completed", {
      requestId,
      method: c.req.method,
      route,
      status,
      durationMs: Math.round(durationSeconds * 1_000 * 100) / 100,
    });
  }
});

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "api",
    timestamp: new Date().toISOString(),
  }),
);

app.get("/ready", async (c) => {
  const checks: Record<string, "ok" | "error"> = { database: "ok", redis: "ok" };

  const dbStartedAt = performance.now();
  try {
    await database.client`select 1`;
  } catch (error) {
    checks.database = "error";
    log.error("readiness_check_failed", { requestId: c.get("requestId"), dependency: "database", error });
  } finally {
    metrics.observeHistogram("whatsapp_readiness_check_duration_seconds", (performance.now() - dbStartedAt) / 1_000, {
      dependency: "database",
    });
  }

  const redisStartedAt = performance.now();
  try {
    await readinessRedis.ping();
  } catch (error) {
    checks.redis = "error";
    log.error("readiness_check_failed", { requestId: c.get("requestId"), dependency: "redis", error });
  } finally {
    metrics.observeHistogram("whatsapp_readiness_check_duration_seconds", (performance.now() - redisStartedAt) / 1_000, {
      dependency: "redis",
    });
  }

  const body = {
    ok: checks.database === "ok" && checks.redis === "ok",
    service: "api",
    checks,
    timestamp: new Date().toISOString(),
  };

  return body.ok ? c.json(body, 200) : c.json(body, 503);
});

app.get("/metrics", async (c) => {
  await refreshDatabaseMetrics();
  c.header("content-type", metrics.contentType);
  return c.body(metrics.render());
});

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
  metrics.incCounter("whatsapp_webhooks_received_total");
  const rawBody = await c.req.text();
  const signature = c.req.header("x-hub-signature-256");

  if (!verifyMetaWebhookSignature(rawBody, signature, env.META_APP_SECRET)) {
    metrics.incCounter("whatsapp_webhook_errors_total", { reason: "invalid_signature" });
    return c.text("Invalid webhook signature", 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    metrics.incCounter("whatsapp_webhook_errors_total", { reason: "invalid_json" });
    return c.json({ error: "Invalid JSON" }, 400);
  }

  if (!payload || typeof payload !== "object" || (payload as Record<string, unknown>).object !== "whatsapp_business_account") {
    metrics.incCounter("whatsapp_webhook_errors_total", { reason: "unsupported_object" });
    return c.json({ error: "Unsupported webhook object" }, 400);
  }

  const parsed = parseWhatsAppWebhook(payload);

  try {
    await persistAndQueueWebhook({
      rawBody,
      payload,
      phoneNumberId: parsed.phoneNumberIds[0] ?? null,
    }, {
      persist: async ({ eventKey, phoneNumberId, payload: durablePayload }) => {
        const [inserted] = await db
          .insert(schema.webhookEvents)
          .values({
            eventKey,
            phoneNumberId,
            payload: durablePayload,
          })
          .onConflictDoNothing({ target: schema.webhookEvents.eventKey })
          .returning({
            id: schema.webhookEvents.id,
            processedAt: schema.webhookEvents.processedAt,
          });

        return inserted ?? (
          await db
            .select({
              id: schema.webhookEvents.id,
              processedAt: schema.webhookEvents.processedAt,
            })
            .from(schema.webhookEvents)
            .where(eq(schema.webhookEvents.eventKey, eventKey))
            .limit(1)
        )[0] ?? null;
      },
      enqueue: (eventId) => webhookQueue.add(
        "process-meta-webhook",
        { eventId },
        { jobId: `webhook-${eventId}` },
      ),
    });
  } catch (error) {
    if (error instanceof WebhookPersistenceError) {
      metrics.incCounter("whatsapp_webhook_errors_total", { reason: "persistence" });
      log.error("meta_webhook_persistence_failed", {
        requestId: c.get("requestId"),
        error,
      });
      return c.json({ error: "Could not persist webhook" }, 500);
    }

    if (error instanceof WebhookQueueError) {
      metrics.incCounter("whatsapp_webhook_errors_total", { reason: "queue_unavailable" });
      log.error("meta_webhook_queue_failed", {
        requestId: c.get("requestId"),
        jobId: `webhook-${error.eventId}`,
        eventId: error.eventId,
        error,
      });
      return c.json({ error: error.message }, 503);
    }

    throw error;
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

log.info("service_started", { url: server.url.toString() });
