import { createHmac, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { createDatabase, schema } from "@wa/db";
import { createRedisClient, createWebhookQueue } from "@wa/queue";

const DEFAULT_DATABASE_URL = "postgres://whatsapp:whatsapp@127.0.0.1:55432/whatsapp_load";
const DEFAULT_REDIS_URL = "redis://127.0.0.1:56379";
const API_URL = "http://127.0.0.1:4400";
const APP_SECRET = "load-test-webhook-secret";

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function positiveInteger(name: string, fallback: number): number {
  const value = Number(argument(name));
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function assertLocalUrl(value: string, label: string): void {
  if (process.env.LOAD_ALLOW_REMOTE === "1") return;
  const url = new URL(value);
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error(`${label} must point to localhost for load tests. Set LOAD_ALLOW_REMOTE=1 only for an isolated test environment.`);
  }
}

async function runCommand(command: string[], env: Record<string, string | undefined> = {}): Promise<void> {
  const child = Bun.spawn(command, {
    env: { ...process.env, ...env },
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(`Command failed (${exitCode}): ${command.join(" ")}`);
}

async function waitForHttp(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Retry until deadline.
    }
    await Bun.sleep(200);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function percentile(values: number[], quantile: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
  return sorted[index] ?? 0;
}

async function settleWithTimeout(promise: Promise<unknown>, timeoutMs = 5_000): Promise<void> {
  await Promise.race([
    promise.then(() => undefined, () => undefined),
    Bun.sleep(timeoutMs),
  ]);
}

function parseRedisMemory(info: string): number {
  const match = info.match(/^used_memory:(\d+)$/m);
  return match ? Number(match[1]) : 0;
}

async function processUsage(pid: number): Promise<{ cpu: number | null; memoryMb: number | null }> {
  const child = Bun.spawn(["ps", "-p", String(pid), "-o", "%cpu=,rss="], { stdout: "pipe", stderr: "ignore" });
  const output = (await new Response(child.stdout).text()).trim();
  await child.exited;
  const [cpuText, rssText] = output.split(/\s+/);
  const cpu = Number(cpuText);
  const rssKb = Number(rssText);
  return {
    cpu: Number.isFinite(cpu) ? cpu : null,
    memoryMb: Number.isFinite(rssKb) ? rssKb / 1_024 : null,
  };
}

async function dockerCpu(container: string): Promise<number | null> {
  const child = Bun.spawn(
    ["docker", "stats", "--no-stream", "--format", "{{.CPUPerc}}", container],
    { stdout: "pipe", stderr: "ignore" },
  );
  const output = (await new Response(child.stdout).text()).trim().replace("%", "");
  const exitCode = await child.exited;
  if (exitCode !== 0) return null;
  const value = Number(output);
  return Number.isFinite(value) ? value : null;
}

async function main() {
  const events = positiveInteger("events", 10_000);
  const concurrency = positiveInteger("concurrency", 200);
  const timeoutMs = positiveInteger("timeout-ms", 120_000);
  const databaseUrl = process.env.LOAD_DATABASE_URL || DEFAULT_DATABASE_URL;
  const redisUrl = process.env.LOAD_REDIS_URL || DEFAULT_REDIS_URL;
  const encryptionKey = process.env.LOAD_CREDENTIAL_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString("base64");
  const manageInfrastructure = process.env.LOAD_MANAGE_INFRA !== "0";
  assertLocalUrl(databaseUrl, "LOAD_DATABASE_URL");
  assertLocalUrl(redisUrl, "LOAD_REDIS_URL");

  if (manageInfrastructure) {
    await runCommand(["docker", "compose", "-f", "docker-compose.load.yml", "up", "-d", "--wait"]);
  }
  await runCommand(["bun", "run", "db:migrate"], { DATABASE_URL: databaseUrl });

  const database = createDatabase(databaseUrl);
  const { db, client } = database;
  const redis = createRedisClient(redisUrl);
  const webhookQueue = createWebhookQueue(redisUrl);
  const runId = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const phoneNumberId = `load-webhook-phone-${runId}`;
  let organizationId: string | null = null;

  await redis.connect();
  await redis.flushdb();

  const [organization] = await db.insert(schema.organizations).values({
    name: `Webhook Load ${runId}`,
    slug: `load-webhook-${runId}`,
  }).returning({ id: schema.organizations.id });
  if (!organization) throw new Error("Could not create webhook load-test organization");
  organizationId = organization.id;

  await db.insert(schema.whatsappPhoneNumbers).values({
    organizationId,
    wabaId: `load-webhook-waba-${runId}`,
    phoneNumberId,
    displayPhoneNumber: "+15559990000",
    verifiedName: "Webhook Load Test",
    status: "connected",
    qualityRating: "GREEN",
    throughputMps: 80,
    credentialKey: `load-webhook-unused-${runId}`,
  });

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
      DEFAULT_META_MPS: "80",
      WORKER_CONCURRENCY: "50",
      WEBHOOK_CONCURRENCY: String(Math.min(1_000, Math.max(100, concurrency))),
      CAMPAIGN_DISPATCH_CONCURRENCY: "2",
      CONTACT_IMPORT_CONCURRENCY: "1",
      R2_ACCOUNT_ID: "load-test",
      R2_ACCESS_KEY_ID: "load-test",
      R2_SECRET_ACCESS_KEY: "load-test",
      R2_BUCKET: "load-test",
    },
    stdout: "inherit",
    stderr: "inherit",
  });

  const samples: Array<{
    at: string;
    queueDepth: number;
    failedJobs: number;
    redisMemoryBytes: number;
    apiCpuPercent: number | null;
    apiMemoryMb: number | null;
    workerCpuPercent: number | null;
    workerMemoryMb: number | null;
    postgresCpuPercent: number | null;
  }> = [];
  let sampling = true;

  try {
    await waitForHttp(`${API_URL}/health`);

    const sampler = (async () => {
      let sampleIndex = 0;
      while (sampling) {
        const [counts, memory, apiUsage, workerUsage] = await Promise.all([
          webhookQueue.getJobCounts("waiting", "active", "delayed", "failed"),
          redis.info("memory").then(parseRedisMemory),
          processUsage(api.pid),
          processUsage(worker.pid),
        ]);
        samples.push({
          at: new Date().toISOString(),
          queueDepth: counts.waiting + counts.active + counts.delayed,
          failedJobs: counts.failed,
          redisMemoryBytes: memory,
          apiCpuPercent: apiUsage.cpu,
          apiMemoryMb: apiUsage.memoryMb,
          workerCpuPercent: workerUsage.cpu,
          workerMemoryMb: workerUsage.memoryMb,
          postgresCpuPercent: sampleIndex % 4 === 0 ? await dockerCpu("whatsapp-load-postgres") : null,
        });
        sampleIndex += 1;
        await Bun.sleep(250);
      }
    })();

    const requestLatencies: number[] = [];
    let nextIndex = 0;
    let accepted = 0;
    let requestFailures = 0;
    const floodStartedAt = Date.now();

    const sender = async () => {
      for (;;) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= events) return;

        const body = JSON.stringify({
          object: "whatsapp_business_account",
          entry: [{
            id: `load-webhook-waba-${runId}`,
            changes: [{
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "+15559990000",
                  phone_number_id: phoneNumberId,
                },
                statuses: [{
                  id: `wamid.load.webhook.${runId}.${index}`,
                  status: "delivered",
                  timestamp: String(Math.floor(Date.now() / 1_000)),
                  recipient_id: String(15550000000 + index),
                }],
              },
            }],
          }],
        });
        const signature = `sha256=${createHmac("sha256", APP_SECRET).update(body, "utf8").digest("hex")}`;
        const startedAt = performance.now();
        try {
          const response = await fetch(`${API_URL}/api/v1/meta/webhook`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-hub-signature-256": signature,
            },
            body,
          });
          requestLatencies.push(performance.now() - startedAt);
          if (response.ok) accepted += 1;
          else requestFailures += 1;
        } catch {
          requestLatencies.push(performance.now() - startedAt);
          requestFailures += 1;
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, events) }, () => sender()));
    const ingestFinishedAt = Date.now();

    const deadline = Date.now() + timeoutMs;
    let processed = 0;
    while (Date.now() < deadline) {
      const [row] = await client`
        SELECT count(*) FILTER (WHERE processed_at IS NOT NULL)::int AS processed
        FROM webhook_events
        WHERE phone_number_id = ${phoneNumberId}
      `;
      processed = Number(row?.processed ?? 0);
      if (processed >= accepted) break;
      await Bun.sleep(100);
    }
    const drainFinishedAt = Date.now();
    sampling = false;
    await sampler;

    const [lag] = await client`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE processed_at IS NOT NULL)::int AS processed,
        percentile_cont(0.50) WITHIN GROUP (ORDER BY extract(epoch FROM (processed_at - created_at)) * 1000) FILTER (WHERE processed_at IS NOT NULL) AS p50_ms,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM (processed_at - created_at)) * 1000) FILTER (WHERE processed_at IS NOT NULL) AS p95_ms,
        percentile_cont(0.99) WITHIN GROUP (ORDER BY extract(epoch FROM (processed_at - created_at)) * 1000) FILTER (WHERE processed_at IS NOT NULL) AS p99_ms,
        max(extract(epoch FROM (processed_at - created_at)) * 1000) FILTER (WHERE processed_at IS NOT NULL) AS max_ms
      FROM webhook_events
      WHERE phone_number_id = ${phoneNumberId}
    `;

    const max = (values: Array<number | null | undefined>) => Math.max(0, ...values.filter((value): value is number => typeof value === "number"));
    const ingestSeconds = Math.max(0.001, (ingestFinishedAt - floodStartedAt) / 1_000);
    const drainSeconds = Math.max(0.001, (drainFinishedAt - floodStartedAt) / 1_000);
    const report = {
      runId,
      events,
      concurrency,
      accepted,
      requestFailures,
      processed: Number(lag?.processed ?? 0),
      ingestSeconds,
      totalDrainSeconds: drainSeconds,
      ingestRequestsPerSecond: accepted / ingestSeconds,
      apiLatencyMs: {
        p50: percentile(requestLatencies, 0.50),
        p95: percentile(requestLatencies, 0.95),
        p99: percentile(requestLatencies, 0.99),
        max: max(requestLatencies),
      },
      webhookLagMs: {
        p50: Number(lag?.p50_ms ?? 0),
        p95: Number(lag?.p95_ms ?? 0),
        p99: Number(lag?.p99_ms ?? 0),
        max: Number(lag?.max_ms ?? 0),
      },
      redisPeakMemoryMb: max(samples.map((sample) => sample.redisMemoryBytes)) / 1024 / 1024,
      redisPeakQueueDepth: max(samples.map((sample) => sample.queueDepth)),
      failedJobVolume: max(samples.map((sample) => sample.failedJobs)),
      postgresPeakCpuPercent: max(samples.map((sample) => sample.postgresCpuPercent)),
      apiPeakCpuPercent: max(samples.map((sample) => sample.apiCpuPercent)),
      apiPeakMemoryMb: max(samples.map((sample) => sample.apiMemoryMb)),
      workerPeakCpuPercent: max(samples.map((sample) => sample.workerCpuPercent)),
      workerPeakMemoryMb: max(samples.map((sample) => sample.workerMemoryMb)),
      samples,
    };

    await mkdir("load-results", { recursive: true });
    const fileBase = `load-results/${new Date(floodStartedAt).toISOString().replace(/[:.]/g, "-")}-webhook-flood-${events}`;
    await Bun.write(`${fileBase}.json`, JSON.stringify(report, null, 2));
    const markdown = `# Webhook flood report\n\n` +
      `- Events: ${events.toLocaleString()}\n` +
      `- Concurrency: ${concurrency}\n` +
      `- Accepted: ${accepted.toLocaleString()}\n` +
      `- Processed: ${report.processed.toLocaleString()}\n` +
      `- Ingest rate: ${report.ingestRequestsPerSecond.toFixed(1)} req/s\n` +
      `- API p50/p95/p99: ${report.apiLatencyMs.p50.toFixed(1)} / ${report.apiLatencyMs.p95.toFixed(1)} / ${report.apiLatencyMs.p99.toFixed(1)} ms\n` +
      `- Webhook lag p50/p95/p99: ${report.webhookLagMs.p50.toFixed(1)} / ${report.webhookLagMs.p95.toFixed(1)} / ${report.webhookLagMs.p99.toFixed(1)} ms\n` +
      `- Redis peak queue depth: ${report.redisPeakQueueDepth}\n` +
      `- Redis peak memory: ${report.redisPeakMemoryMb.toFixed(1)} MB\n` +
      `- Postgres peak CPU: ${report.postgresPeakCpuPercent.toFixed(1)}%\n` +
      `- API peak CPU: ${report.apiPeakCpuPercent.toFixed(1)}%\n` +
      `- Worker peak CPU: ${report.workerPeakCpuPercent.toFixed(1)}%\n` +
      `- Failed-job volume: ${report.failedJobVolume}\n`;
    await Bun.write(`${fileBase}.md`, markdown);
    console.log(markdown);
    console.log(`Report written to ${fileBase}.json and ${fileBase}.md`);

    if (accepted !== events || report.processed !== accepted) {
      throw new Error(`Webhook flood incomplete: accepted ${accepted}/${events}, processed ${report.processed}/${accepted}`);
    }
  } finally {
    sampling = false;
    api.kill("SIGTERM");
    worker.kill("SIGTERM");
    await settleWithTimeout(Promise.allSettled([api.exited, worker.exited]));
    try { api.kill("SIGKILL"); } catch {}
    try { worker.kill("SIGKILL"); } catch {}
    await client`DELETE FROM webhook_events WHERE phone_number_id = ${phoneNumberId}`.catch(() => undefined);
    if (organizationId) {
      await client`DELETE FROM organizations WHERE id = ${organizationId}::uuid`.catch(() => undefined);
    }
    await settleWithTimeout(webhookQueue.close());
    if (redis.status !== "end") await settleWithTimeout(redis.quit());
    await settleWithTimeout(database.client.end());
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
