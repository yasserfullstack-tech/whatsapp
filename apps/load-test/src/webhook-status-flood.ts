import { createHmac, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { createDatabase, schema } from "@wa/db";
import { createRedisClient, createWebhookQueue } from "@wa/queue";
import { summarizeThresholds, type ThresholdCheck } from "./thresholds";

const DEFAULT_DATABASE_URL = "postgres://whatsapp:whatsapp@127.0.0.1:55432/whatsapp_load";
const DEFAULT_REDIS_URL = "redis://127.0.0.1:56379";
const API_URL = "http://127.0.0.1:4400";
const APP_SECRET = "load-test-webhook-secret";

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function integerArgument(name: string, fallback: number): number {
  const parsed = Number(argument(name));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function assertLocal(value: string, label: string): void {
  const url = new URL(value);
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error(`${label} must point to localhost. Webhook chaos tests never run against remote infrastructure.`);
  }
}

async function run(command: string[], env: Record<string, string> = {}, timeoutMs = 120_000): Promise<void> {
  const child = Bun.spawn(command, { env: { ...process.env, ...env }, stdout: "inherit", stderr: "inherit" });
  const outcome = await Promise.race([
    child.exited.then((code) => ({ kind: "exit" as const, code })),
    Bun.sleep(timeoutMs).then(() => ({ kind: "timeout" as const })),
  ]);
  if (outcome.kind === "timeout") {
    child.kill("SIGKILL");
    await Promise.race([child.exited.then(() => undefined), Bun.sleep(2_000)]);
    throw new Error(`Command timed out after ${timeoutMs} ms: ${command.join(" ")}`);
  }
  if (outcome.code !== 0) throw new Error(`Command failed (${outcome.code}): ${command.join(" ")}`);
}

async function waitForHttp(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Service is still starting.
    }
    await Bun.sleep(200);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function settle(promise: Promise<unknown>, timeoutMs = 5_000): Promise<void> {
  await Promise.race([promise.then(() => undefined, () => undefined), Bun.sleep(timeoutMs)]);
}

async function stopChild(child: ReturnType<typeof Bun.spawn>, label: string, timeoutMs = 5_000): Promise<void> {
  child.kill("SIGTERM");
  const stopped = await Promise.race([
    child.exited.then(() => true, () => true),
    Bun.sleep(timeoutMs).then(() => false),
  ]);
  if (stopped) return;
  console.warn(`${label} did not exit after SIGTERM; forcing SIGKILL`);
  child.kill("SIGKILL");
  await settle(child.exited, 2_000);
}

function percentile(values: number[], quantile: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
  return sorted[index] ?? 0;
}

function check(metric: string, observed: number, operator: "<=" | ">=" | "=", limit: number): ThresholdCheck {
  const pass = operator === "<=" ? observed <= limit : operator === ">=" ? observed >= limit : observed === limit;
  return { metric, observed, operator, limit, pass };
}

function payload(input: {
  wabaId: string;
  phoneNumberId: string;
  wamid: string;
  recipient: string;
  timestamp: number;
}): string {
  const { wabaId, phoneNumberId, wamid, recipient, timestamp } = input;
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{
      id: wabaId,
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "+15559990001", phone_number_id: phoneNumberId },
          statuses: [
            { id: wamid, status: "read", timestamp: String(timestamp + 4), recipient_id: recipient },
            { id: wamid, status: "sent", timestamp: String(timestamp + 1), recipient_id: recipient },
            {
              id: wamid,
              status: "failed",
              timestamp: String(timestamp + 3),
              recipient_id: recipient,
              errors: [{ code: 131000, title: "load-test stale failure", message: "must not overwrite read" }],
            },
            { id: wamid, status: "delivered", timestamp: String(timestamp + 2), recipient_id: recipient },
          ],
        },
      }],
    }],
  });
}

async function main() {
  const recipients = integerArgument("recipients", 10_000);
  const concurrency = integerArgument("concurrency", 200);
  const timeoutMs = integerArgument("timeout-ms", 300_000);
  const databaseUrl = process.env.LOAD_DATABASE_URL || DEFAULT_DATABASE_URL;
  const redisUrl = process.env.LOAD_REDIS_URL || DEFAULT_REDIS_URL;
  assertLocal(databaseUrl, "LOAD_DATABASE_URL");
  assertLocal(redisUrl, "LOAD_REDIS_URL");

  await run(["docker", "compose", "-f", "docker-compose.load.yml", "up", "-d", "--wait"]);
  await run(["bun", "run", "db:migrate"], { DATABASE_URL: databaseUrl });

  const database = createDatabase(databaseUrl);
  const { db, client } = database;
  const redis = createRedisClient(redisUrl);
  const webhookQueue = createWebhookQueue(redisUrl);
  const runId = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const wabaId = `load-status-waba-${runId}`;
  const phoneNumberId = `load-status-phone-${runId}`;
  const encryptionKey = Buffer.alloc(32, 7).toString("base64");
  let organizationId: string | null = null;
  const startedAt = new Date();
  const latencies: number[] = [];
  let accepted = 0;
  let requestFailures = 0;

  await redis.connect();
  await redis.flushdb();

  const [organization] = await db.insert(schema.organizations).values({
    name: `Webhook status flood ${runId}`,
    slug: `load-status-${runId}`,
  }).returning({ id: schema.organizations.id });
  if (!organization) throw new Error("Could not create status-flood organization");
  organizationId = organization.id;

  const [phone] = await db.insert(schema.whatsappPhoneNumbers).values({
    organizationId,
    wabaId,
    phoneNumberId,
    displayPhoneNumber: "+15559990001",
    verifiedName: "Webhook Status Load",
    status: "connected",
    qualityRating: "GREEN",
    throughputMps: 1_000,
    credentialKey: `unused-${runId}`,
  }).returning({ id: schema.whatsappPhoneNumbers.id });
  if (!phone) throw new Error("Could not create status-flood phone");

  const [template] = await db.insert(schema.templates).values({
    organizationId,
    wabaId,
    metaTemplateId: `load-status-template-${runId}`,
    name: `load_status_${runId.replace(/-/g, "_")}`,
    language: "en",
    category: "marketing",
    status: "approved",
    metaStatus: "APPROVED",
    bodyPreview: "Webhook status load",
    components: [],
  }).returning({ id: schema.templates.id });
  if (!template) throw new Error("Could not create status-flood template");

  const [campaign] = await db.insert(schema.campaigns).values({
    organizationId,
    whatsappPhoneNumberId: phone.id,
    templateId: template.id,
    name: `Webhook status campaign ${runId}`,
    status: "sending",
    recipientCount: recipients,
    snapshotCreatedAt: new Date(),
    startedAt: new Date(),
    templateBindings: [],
  }).returning({ id: schema.campaigns.id });
  if (!campaign) throw new Error("Could not create status-flood campaign");

  await client`
    INSERT INTO contacts (
      id, organization_id, phone_e164, display_name, opted_in, opt_in_source, opt_in_at, created_at, updated_at
    )
    SELECT
      gen_random_uuid(), ${organizationId}::uuid,
      '+' || (16660000000::bigint + g)::text,
      'Webhook Status ' || g::text,
      true, 'load_test', now(), now(), now()
    FROM generate_series(1, ${recipients}) AS g
  `;

  await client`
    INSERT INTO campaign_recipients (
      id, organization_id, campaign_id, contact_id, phone_e164, display_name, status, wamid, submitted_at, created_at, updated_at
    )
    SELECT
      gen_random_uuid(), ${organizationId}::uuid, ${campaign.id}::uuid, c.id, c.phone_e164, c.display_name,
      'submitted', ${`wamid.load.status.${runId}.`} || c.phone_e164, now(), now(), now()
    FROM contacts c
    WHERE c.organization_id = ${organizationId}::uuid
  `;

  const api = Bun.spawn(["bun", "apps/api/src/index.ts"], {
    env: {
      ...process.env,
      NODE_ENV: "test",
      API_PORT: "4400",
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl,
      META_GRAPH_API_VERSION: "v26.0",
      META_APP_SECRET: APP_SECRET,
      META_VERIFY_TOKEN: "load-test-verify-token",
    },
    stdout: "inherit",
    stderr: "inherit",
  });
  const worker = Bun.spawn(["bun", "--preload", "./apps/load-test/src/fetch-redirect.ts", "apps/worker/src/index.ts"], {
    env: {
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl,
      CREDENTIAL_ENCRYPTION_KEY: encryptionKey,
      META_GRAPH_API_VERSION: "v26.0",
      META_SEND_API_BASE_URL: "http://127.0.0.1:4100",
      DEFAULT_META_MPS: "1",
      WORKER_CONCURRENCY: "1",
      WEBHOOK_CONCURRENCY: String(Math.min(1_000, Math.max(100, concurrency))),
      CAMPAIGN_DISPATCH_CONCURRENCY: "1",
      CONTACT_IMPORT_CONCURRENCY: "1",
      R2_ACCOUNT_ID: "load-test",
      R2_ACCESS_KEY_ID: "load-test",
      R2_SECRET_ACCESS_KEY: "load-test",
      R2_BUCKET: "load-test",
    },
    stdout: "inherit",
    stderr: "inherit",
  });

  try {
    await waitForHttp(`${API_URL}/health`);
    const totalRequests = recipients * 2;
    let next = 0;
    const deadline = Date.now() + timeoutMs;
    const floodStartedAt = Date.now();

    const sender = async () => {
      for (;;) {
        const requestIndex = next++;
        if (requestIndex >= totalRequests || Date.now() >= deadline) return;
        const recipientIndex = Math.floor(requestIndex / 2) + 1;
        const phone = `+${16660000000n + BigInt(recipientIndex)}`;
        const body = payload({
          wabaId,
          phoneNumberId,
          wamid: `wamid.load.status.${runId}.${phone}`,
          recipient: phone.slice(1),
          timestamp: Math.floor(floodStartedAt / 1_000),
        });
        const signature = `sha256=${createHmac("sha256", APP_SECRET).update(body, "utf8").digest("hex")}`;
        const requestStarted = performance.now();
        try {
          const response = await fetch(`${API_URL}/api/v1/meta/webhook`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-hub-signature-256": signature },
            body,
            signal: AbortSignal.timeout(Math.max(1, Math.min(30_000, deadline - Date.now()))),
          });
          latencies.push(performance.now() - requestStarted);
          if (response.ok) accepted += 1;
          else requestFailures += 1;
        } catch {
          latencies.push(performance.now() - requestStarted);
          requestFailures += 1;
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, totalRequests) }, () => sender()));
    const ingestFinishedAt = Date.now();

    let persisted = 0;
    let processed = 0;
    while (Date.now() < deadline) {
      const [row] = await client`
        SELECT count(*)::int AS persisted,
               count(*) FILTER (WHERE processed_at IS NOT NULL)::int AS processed
        FROM webhook_events
        WHERE phone_number_id = ${phoneNumberId}
      `;
      persisted = Number(row?.persisted ?? 0);
      processed = Number(row?.processed ?? 0);
      if (processed >= recipients) break;
      await Bun.sleep(100);
    }
    const drainedAt = Date.now();

    const [recipientStates] = await client`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE status = 'read')::int AS read,
        count(*) FILTER (WHERE status = 'failed')::int AS failed,
        count(*) FILTER (WHERE status = 'delivered')::int AS delivered,
        count(*) FILTER (WHERE status = 'sent')::int AS sent
      FROM campaign_recipients
      WHERE campaign_id = ${campaign.id}::uuid
    `;
    const [eventStates] = await client`
      SELECT
        count(*)::int AS total,
        max(processing_attempts)::int AS max_attempts,
        sum(processing_attempts)::bigint AS attempts,
        count(*) FILTER (WHERE dead_lettered_at IS NOT NULL)::int AS dead_letters
      FROM webhook_events
      WHERE phone_number_id = ${phoneNumberId}
    `;
    const queueCounts = await webhookQueue.getJobCounts("waiting", "active", "delayed", "failed");
    const ingestSeconds = Math.max(0.001, (ingestFinishedAt - floodStartedAt) / 1_000);
    const drainSeconds = Math.max(0.001, (drainedAt - ingestFinishedAt) / 1_000);
    const p95 = percentile(latencies, 0.95);
    const p99 = percentile(latencies, 0.99);

    const thresholds = summarizeThresholds([
      check("HTTP requests accepted including exact replays", accepted, "=", totalRequests),
      check("request failures", requestFailures, "=", 0),
      check("durable inbox deduplicated events", persisted, "=", recipients),
      check("durable inbox processed events", processed, "=", recipients),
      check("recipients preserved at read", Number(recipientStates?.read ?? 0), "=", recipients),
      check("recipients regressed to failed", Number(recipientStates?.failed ?? 0), "=", 0),
      check("recipients regressed to delivered", Number(recipientStates?.delivered ?? 0), "=", 0),
      check("recipients regressed to sent", Number(recipientStates?.sent ?? 0), "=", 0),
      check("max durable processing attempts", Number(eventStates?.max_attempts ?? 0), "<=", 1),
      check("dead-lettered events", Number(eventStates?.dead_letters ?? 0), "=", 0),
      check("webhook API p95 ms", p95, "<=", 1_000),
      check("webhook API p99 ms", p99, "<=", 2_500),
      check("post-ingest drain seconds", drainSeconds, "<=", Math.max(30, recipients / 200)),
      check("BullMQ terminal failed jobs", Number(queueCounts.failed ?? 0), "=", 0),
    ]);

    const report = {
      runId,
      recipients,
      requests: totalRequests,
      accepted,
      requestFailures,
      persisted,
      processed,
      ingestSeconds,
      ingestRequestsPerSecond: accepted / ingestSeconds,
      drainSeconds,
      apiLatencyMs: { p50: percentile(latencies, 0.5), p95, p99, max: Math.max(0, ...latencies) },
      recipientStates,
      eventStates,
      queueCounts,
      thresholds,
      passed: thresholds.passed,
    };
    await mkdir("load-results", { recursive: true });
    const base = `load-results/${startedAt.toISOString().replace(/[:.]/g, "-")}-webhook-status-flood-${recipients}`;
    await Bun.write(`${base}.json`, JSON.stringify(report, null, 2));
    const checks = thresholds.checks
      .map((item) => `- ${item.pass ? "PASS" : "FAIL"} — ${item.metric}: ${item.observed} ${item.operator} ${item.limit}`)
      .join("\n");
    const markdown = `# Duplicate / out-of-order webhook flood\n\n` +
      `- Recipients: ${recipients.toLocaleString()}\n` +
      `- HTTP requests: ${totalRequests.toLocaleString()} (every payload replayed once)\n` +
      `- Unique durable events: ${persisted.toLocaleString()}\n` +
      `- Ingest rate: ${(accepted / ingestSeconds).toFixed(1)} req/s\n` +
      `- API p50/p95/p99: ${percentile(latencies, 0.5).toFixed(1)} / ${p95.toFixed(1)} / ${p99.toFixed(1)} ms\n` +
      `- Drain after ingest: ${drainSeconds.toFixed(2)} s\n` +
      `- Final read recipients: ${Number(recipientStates?.read ?? 0).toLocaleString()}\n` +
      `- Final failed recipients: ${Number(recipientStates?.failed ?? 0).toLocaleString()}\n` +
      `- Result: ${thresholds.passed ? "PASS" : "FAIL"}\n\n## Thresholds\n\n${checks}\n`;
    await Bun.write(`${base}.md`, markdown);
    console.log(markdown);
    console.log(`Webhook status report: ${base}.json and ${base}.md`);
    if (!thresholds.passed) process.exitCode = 1;
  } finally {
    await Promise.all([
      stopChild(api, "webhook status API"),
      stopChild(worker, "webhook status worker"),
    ]);
    if (organizationId) {
      try {
        await client`DELETE FROM organizations WHERE id = ${organizationId}::uuid`;
      } catch (error) {
        console.warn("Webhook status cleanup could not delete synthetic organization", error);
      }
    }
    await settle(webhookQueue.close());
    if (redis.status !== "end") await settle(redis.quit());
    await settle(database.client.end());
    try {
      await run(["docker", "compose", "-f", "docker-compose.load.yml", "down", "--remove-orphans"], {}, 30_000);
    } catch (error) {
      console.warn("Webhook status cleanup could not stop load-test compose stack", error);
    }
  }
}

main().then(() => {
  process.exit(process.exitCode ?? 0);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});