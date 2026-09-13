import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { encryptSecret } from "@wa/credentials";
import { createDatabase, schema } from "@wa/db";
import {
  createCampaignDispatchQueue,
  createRedisClient,
  createSendQueue,
} from "@wa/queue";

type Scenario = {
  name: string;
  recipients: number;
  campaigns: number;
  organizations: number;
  phonesPerOrganization: number;
  messagesPerSecond: number;
  workerConcurrency: number;
  fakeLatencyMs: number;
  fakeJitterMs: number;
  fakeErrorRate: number;
  fake429Rate: number;
  fake500Rate: number;
};

type MetricSample = {
  at: string;
  queueDepth: number;
  queueWaiting: number;
  queueActive: number;
  queueDelayed: number;
  queueFailed: number;
  redisMemoryBytes: number;
  postgresConnections: number;
  postgresWrites: number;
  postgresCpuPercent: number | null;
  workerCpuPercent: number | null;
  workerMemoryMb: number | null;
};

type CampaignResult = {
  campaignId: string;
  snapshotMs: number | null;
  timeToFirstMessageMs: number | null;
  completedMs: number | null;
  submitted: number;
  failed: number;
  stableThroughputMps: number;
};

const DEFAULT_DATABASE_URL = "postgres://whatsapp:whatsapp@127.0.0.1:55432/whatsapp_load";
const DEFAULT_REDIS_URL = "redis://127.0.0.1:56379";
const FAKE_META_URL = "http://127.0.0.1:4100";

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function integerArgument(name: string, fallback: number): number {
  const value = Number(argument(name));
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function numberArgument(name: string, fallback: number): number {
  const value = Number(argument(name));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function scenarioFromArgs(): Scenario {
  const name = argument("scenario") || "baseline-80";
  const presets: Record<string, Partial<Scenario>> = {
    "baseline-80": { messagesPerSecond: 80 },
    "baseline-1000": { messagesPerSecond: 1_000, workerConcurrency: 1_200 },
    "concurrent-10": { campaigns: 10, organizations: 1, phonesPerOrganization: 10, messagesPerSecond: 1_000, workerConcurrency: 1_500 },
    "multi-org": { campaigns: 8, organizations: 4, phonesPerOrganization: 2, messagesPerSecond: 1_000, workerConcurrency: 1_500 },
    "slow-meta": { messagesPerSecond: 1_000, workerConcurrency: 1_500, fakeLatencyMs: 500, fakeJitterMs: 150 },
    "meta-429": { messagesPerSecond: 1_000, workerConcurrency: 1_500, fake429Rate: 0.25 },
    "meta-500": { messagesPerSecond: 1_000, workerConcurrency: 1_500, fake500Rate: 0.25 },
  };
  const preset = presets[name];
  if (!preset) throw new Error(`Unknown scenario: ${name}. Choose ${Object.keys(presets).join(", ")}`);

  const base: Scenario = {
    name,
    recipients: 1_000,
    campaigns: 1,
    organizations: 1,
    phonesPerOrganization: 1,
    messagesPerSecond: 80,
    workerConcurrency: 400,
    fakeLatencyMs: 25,
    fakeJitterMs: 10,
    fakeErrorRate: 0,
    fake429Rate: 0,
    fake500Rate: 0,
    ...preset,
  };

  return {
    ...base,
    recipients: integerArgument("recipients", base.recipients),
    campaigns: integerArgument("campaigns", base.campaigns),
    organizations: integerArgument("organizations", base.organizations),
    phonesPerOrganization: integerArgument("phones", base.phonesPerOrganization),
    messagesPerSecond: integerArgument("mps", base.messagesPerSecond),
    workerConcurrency: integerArgument("worker-concurrency", base.workerConcurrency),
    fakeLatencyMs: numberArgument("latency-ms", base.fakeLatencyMs),
    fakeJitterMs: numberArgument("jitter-ms", base.fakeJitterMs),
    fakeErrorRate: Math.min(1, numberArgument("error-rate", base.fakeErrorRate)),
    fake429Rate: Math.min(1, numberArgument("429-rate", base.fake429Rate)),
    fake500Rate: Math.min(1, numberArgument("500-rate", base.fake500Rate)),
  };
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
    await Bun.sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
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
  const scenario = scenarioFromArgs();
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

  const fakeMeta = Bun.spawn(["bun", "apps/load-test/src/fake-meta.ts"], {
    env: {
      ...process.env,
      FAKE_META_PORT: "4100",
      FAKE_META_LATENCY_MS: String(scenario.fakeLatencyMs),
      FAKE_META_JITTER_MS: String(scenario.fakeJitterMs),
      FAKE_META_ERROR_RATE: String(scenario.fakeErrorRate),
      FAKE_META_429_RATE: String(scenario.fake429Rate),
      FAKE_META_500_RATE: String(scenario.fake500Rate),
    },
    stdout: "inherit",
    stderr: "inherit",
  });

  await waitForHttp(`${FAKE_META_URL}/health`);

  const worker = Bun.spawn(["bun", "--preload", "./apps/load-test/src/fetch-redirect.ts", "apps/worker/src/index.ts"], {
    env: {
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl,
      CREDENTIAL_ENCRYPTION_KEY: encryptionKey,
      META_GRAPH_API_VERSION: "v26.0",
      META_SEND_API_BASE_URL: FAKE_META_URL,
      DEFAULT_META_MPS: String(scenario.messagesPerSecond),
      WORKER_CONCURRENCY: String(scenario.workerConcurrency),
      WEBHOOK_CONCURRENCY: "200",
      CAMPAIGN_DISPATCH_CONCURRENCY: String(Math.min(100, Math.max(8, scenario.campaigns))),
      CONTACT_IMPORT_CONCURRENCY: "2",
      R2_ACCOUNT_ID: "load-test",
      R2_ACCESS_KEY_ID: "load-test",
      R2_SECRET_ACCESS_KEY: "load-test",
      R2_BUCKET: "load-test",
    },
    stdout: "inherit",
    stderr: "inherit",
  });

  const database = createDatabase(databaseUrl);
  const { db, client } = database;
  const redis = createRedisClient(redisUrl);
  const dispatchQueue = createCampaignDispatchQueue(redisUrl);
  const sendQueue = createSendQueue(redisUrl);
  const runId = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const organizationIds: string[] = [];
  const campaignIds: string[] = [];
  let startedAt = 0;
  const samples: MetricSample[] = [];

  try {
    await redis.connect();
    await Promise.all([
      dispatchQueue.obliterate({ force: true }),
      sendQueue.obliterate({ force: true }),
    ]);
    await client`DELETE FROM organizations WHERE slug LIKE 'load-%'`;
    await fetch(`${FAKE_META_URL}/__reset`, { method: "POST" });

    const organizations = Math.min(scenario.organizations, scenario.campaigns);
    const phonesByOrg = new Map<string, Array<{ id: string; phoneNumberId: string; templateId: string }>>();

    for (let orgIndex = 0; orgIndex < organizations; orgIndex += 1) {
      const [organization] = await db.insert(schema.organizations).values({
        name: `Load Test ${runId} ${orgIndex + 1}`,
        slug: `load-${runId}-${orgIndex + 1}`,
      }).returning({ id: schema.organizations.id });
      if (!organization) throw new Error("Could not create load-test organization");
      organizationIds.push(organization.id);

      await client`
        INSERT INTO contacts (
          id, organization_id, phone_e164, display_name, opted_in, opt_in_source, opt_in_at, created_at, updated_at
        )
        SELECT
          gen_random_uuid(),
          ${organization.id}::uuid,
          '+' || (15550000000::bigint + g)::text,
          'Load Contact ' || g::text,
          true,
          'load_test',
          now(),
          now(),
          now()
        FROM generate_series(1, ${scenario.recipients}) AS g
      `;

      const phones: Array<{ id: string; phoneNumberId: string; templateId: string }> = [];
      for (let phoneIndex = 0; phoneIndex < scenario.phonesPerOrganization; phoneIndex += 1) {
        const credentialKey = `load:${runId}:${orgIndex}:${phoneIndex}`;
        const encrypted = encryptSecret("fake-meta-token", encryptionKey);
        await db.insert(schema.credentialSecrets).values({
          organizationId: organization.id,
          key: credentialKey,
          ...encrypted,
        });

        const wabaId = `load-waba-${runId}-${orgIndex}`;
        const phoneNumberId = `load-phone-${runId}-${orgIndex}-${phoneIndex}`;
        const [phone] = await db.insert(schema.whatsappPhoneNumbers).values({
          organizationId: organization.id,
          wabaId,
          phoneNumberId,
          displayPhoneNumber: `+1555${String(orgIndex).padStart(2, "0")}${String(phoneIndex).padStart(4, "0")}`,
          verifiedName: "Load Test",
          status: "connected",
          qualityRating: "GREEN",
          throughputMps: scenario.messagesPerSecond,
          credentialKey,
        }).returning({ id: schema.whatsappPhoneNumbers.id });
        if (!phone) throw new Error("Could not create load-test phone number");

        const [template] = await db.insert(schema.templates).values({
          organizationId: organization.id,
          wabaId,
          metaTemplateId: `load-template-${runId}-${orgIndex}-${phoneIndex}`,
          name: `load_test_${orgIndex}_${phoneIndex}`,
          language: "en",
          category: "marketing",
          status: "approved",
          metaStatus: "APPROVED",
          bodyPreview: "Load test message",
          components: [{ type: "BODY", text: "Load test message" }],
        }).returning({ id: schema.templates.id });
        if (!template) throw new Error("Could not create load-test template");
        phones.push({ id: phone.id, phoneNumberId, templateId: template.id });
      }
      phonesByOrg.set(organization.id, phones);
    }

    for (let campaignIndex = 0; campaignIndex < scenario.campaigns; campaignIndex += 1) {
      const organizationId = organizationIds[campaignIndex % organizationIds.length]!;
      const phones = phonesByOrg.get(organizationId)!;
      const phone = phones[Math.floor(campaignIndex / organizationIds.length) % phones.length]!;
      const [campaign] = await db.insert(schema.campaigns).values({
        organizationId,
        whatsappPhoneNumberId: phone.id,
        templateId: phone.templateId,
        name: `Load Campaign ${runId} ${campaignIndex + 1}`,
        status: "dispatching",
        templateBindings: [],
      }).returning({ id: schema.campaigns.id });
      if (!campaign) throw new Error("Could not create load-test campaign");
      campaignIds.push(campaign.id);

      await db.insert(schema.campaignAudiences).values({
        organizationId,
        campaignId: campaign.id,
        type: "all",
        sourceName: "All load-test contacts",
        definition: { type: "all" },
      });
    }

    const baselineStats = await client`
      SELECT (tup_inserted + tup_updated + tup_deleted)::bigint AS writes
      FROM pg_stat_database
      WHERE datname = current_database()
    `;
    const baselineWrites = Number(baselineStats[0]?.writes ?? 0);

    startedAt = Date.now();

    for (let index = 0; index < campaignIds.length; index += 1) {
      const campaignId = campaignIds[index]!;
      const organizationId = organizationIds[index % organizationIds.length]!;
      await dispatchQueue.add(
        "dispatch-campaign",
        { organizationId, campaignId },
        { jobId: `load-campaign-${campaignId}` },
      );
    }

    const theoreticalSeconds = (scenario.recipients * scenario.campaigns) /
      Math.max(1, scenario.messagesPerSecond * Math.min(scenario.campaigns, scenario.organizations * scenario.phonesPerOrganization));
    const timeoutMs = integerArgument("timeout-ms", Math.max(120_000, Math.ceil(theoreticalSeconds * 4_000)));
    const deadline = Date.now() + timeoutMs;
    let allTerminal = false;

    while (Date.now() < deadline) {
      const states = await Promise.all(campaignIds.map(async (campaignId) => {
        const rows = await client`
          SELECT status, snapshot_created_at, completed_at
          FROM campaigns
          WHERE id = ${campaignId}::uuid
        `;
        return rows[0] as { status?: string; snapshot_created_at?: Date | null; completed_at?: Date | null } | undefined;
      }));
      allTerminal = states.every((row) => row && ["completed", "failed", "cancelled"].includes(String(row.status)));

      const queueCounts = await sendQueue.getJobCounts("waiting", "active", "delayed", "failed");
      const redisMemoryBytes = parseRedisMemory(await redis.info("memory"));
      const [connectionRows, writeRows] = await Promise.all([
        client`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database()`,
        client`
          SELECT (tup_inserted + tup_updated + tup_deleted)::bigint AS writes
          FROM pg_stat_database
          WHERE datname = current_database()
        `,
      ]);
      const workerUsage = await processUsage(worker.pid);
      const postgresCpuPercent = samples.length % 5 === 0 ? await dockerCpu("whatsapp-load-postgres") : null;
      const postgresWrites = Math.max(0, Number(writeRows[0]?.writes ?? 0) - baselineWrites);
      samples.push({
        at: new Date().toISOString(),
        queueDepth: queueCounts.waiting + queueCounts.active + queueCounts.delayed,
        queueWaiting: queueCounts.waiting,
        queueActive: queueCounts.active,
        queueDelayed: queueCounts.delayed,
        queueFailed: queueCounts.failed,
        redisMemoryBytes,
        postgresConnections: Number(connectionRows[0]?.count ?? 0),
        postgresWrites,
        postgresCpuPercent,
        workerCpuPercent: workerUsage.cpu,
        workerMemoryMb: workerUsage.memoryMb,
      });

      if (allTerminal) break;
      await Bun.sleep(1_000);
    }

    const finishedAt = Date.now();
    const campaignResults: CampaignResult[] = [];
    for (const campaignId of campaignIds) {
      const [row] = await client`
        SELECT
          c.snapshot_created_at,
          c.completed_at,
          min(cr.submitted_at) AS first_submitted_at,
          max(cr.submitted_at) AS last_submitted_at,
          count(*) FILTER (WHERE cr.status IN ('submitted','sent','delivered','read'))::int AS submitted,
          count(*) FILTER (WHERE cr.status = 'failed')::int AS failed
        FROM campaigns c
        LEFT JOIN campaign_recipients cr ON cr.campaign_id = c.id
        WHERE c.id = ${campaignId}::uuid
        GROUP BY c.id
      `;
      const snapshotAt = row?.snapshot_created_at ? new Date(row.snapshot_created_at).getTime() : null;
      const completedAt = row?.completed_at ? new Date(row.completed_at).getTime() : null;
      const firstSubmittedAt = row?.first_submitted_at ? new Date(row.first_submitted_at).getTime() : null;
      const lastSubmittedAt = row?.last_submitted_at ? new Date(row.last_submitted_at).getTime() : null;
      const submitted = Number(row?.submitted ?? 0);
      const windowSeconds = firstSubmittedAt && lastSubmittedAt
        ? Math.max(0.001, (lastSubmittedAt - firstSubmittedAt) / 1_000)
        : 0;
      campaignResults.push({
        campaignId,
        snapshotMs: snapshotAt ? snapshotAt - startedAt : null,
        timeToFirstMessageMs: firstSubmittedAt ? firstSubmittedAt - startedAt : null,
        completedMs: completedAt ? completedAt - startedAt : null,
        submitted,
        failed: Number(row?.failed ?? 0),
        stableThroughputMps: windowSeconds ? submitted / windowSeconds : 0,
      });
    }

    const fakeStats = await fetch(`${FAKE_META_URL}/__stats`).then((response) => response.json()) as {
      requests: number;
      succeeded: number;
      latencyMs: { p50: number; p95: number; p99: number; max: number };
    };
    const totalExpected = scenario.recipients * scenario.campaigns;
    const totalSubmitted = campaignResults.reduce((sum, item) => sum + item.submitted, 0);
    const totalFailed = campaignResults.reduce((sum, item) => sum + item.failed, 0);
    const max = (values: Array<number | null | undefined>) => Math.max(0, ...values.filter((value): value is number => typeof value === "number"));
    const firstMessageValues = campaignResults
      .map((item) => item.timeToFirstMessageMs)
      .filter((value): value is number => typeof value === "number");
    const activeSendChannels = Math.min(scenario.campaigns, scenario.organizations * scenario.phonesPerOrganization);
    const targetAggregateMps = scenario.messagesPerSecond * activeSendChannels;
    const observedAggregateMps = campaignResults.reduce((sum, item) => sum + item.stableThroughputMps, 0);
    const totalSeconds = Math.max(0.001, (finishedAt - startedAt) / 1_000);
    const report = {
      runId,
      scenario,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date(finishedAt).toISOString(),
      terminal: allTerminal,
      totals: {
        expectedRecipients: totalExpected,
        submitted: totalSubmitted,
        failed: totalFailed,
        retryVolume: Math.max(0, fakeStats.requests - totalSubmitted - totalFailed),
        durationSeconds: totalSeconds,
      },
      summary: {
        snapshotSeconds: max(campaignResults.map((item) => item.snapshotMs)) / 1_000,
        timeToFirstMessageSeconds: firstMessageValues.length ? Math.min(...firstMessageValues) / 1_000 : null,
        stableThroughputMps: observedAggregateMps,
        apiLatencyMs: fakeStats.latencyMs,
        redisPeakMemoryMb: max(samples.map((item) => item.redisMemoryBytes)) / 1024 / 1024,
        redisPeakQueueDepth: max(samples.map((item) => item.queueDepth)),
        postgresPeakCpuPercent: max(samples.map((item) => item.postgresCpuPercent)),
        postgresPeakConnections: max(samples.map((item) => item.postgresConnections)),
        postgresWritesPerSecond: (samples.at(-1)?.postgresWrites ?? 0) / totalSeconds,
        workerPeakCpuPercent: max(samples.map((item) => item.workerCpuPercent)),
        workerPeakMemoryMb: max(samples.map((item) => item.workerMemoryMb)),
        workerInstancesEstimate: Math.max(1, Math.ceil(targetAggregateMps / Math.max(1, observedAggregateMps))),
        failedJobVolume: max(samples.map((item) => item.queueFailed)),
      },
      campaigns: campaignResults,
      samples,
      fakeMeta: fakeStats,
    };

    await mkdir("load-results", { recursive: true });
    const fileBase = `load-results/${new Date(startedAt).toISOString().replace(/[:.]/g, "-")}-${scenario.name}-${scenario.recipients}`;
    await Bun.write(`${fileBase}.json`, JSON.stringify(report, null, 2));
    const markdown = `# Load test report\n\n` +
      `- Scenario: ${scenario.name}\n` +
      `- Recipients per campaign: ${scenario.recipients.toLocaleString()}\n` +
      `- Campaigns: ${scenario.campaigns}\n` +
      `- Target MPS: ${scenario.messagesPerSecond}\n` +
      `- Snapshot: ${report.summary.snapshotSeconds.toFixed(2)} sec\n` +
      `- Time to first send: ${report.summary.timeToFirstMessageSeconds === null ? "n/a" : `${report.summary.timeToFirstMessageSeconds.toFixed(2)} sec`}\n` +
      `- Stable throughput: ${report.summary.stableThroughputMps.toFixed(1)} msg/s\n` +
      `- API p50/p95/p99: ${fakeStats.latencyMs.p50.toFixed(1)} / ${fakeStats.latencyMs.p95.toFixed(1)} / ${fakeStats.latencyMs.p99.toFixed(1)} ms\n` +
      `- DB peak CPU: ${report.summary.postgresPeakCpuPercent.toFixed(1)}%\n` +
      `- DB peak connections: ${report.summary.postgresPeakConnections}\n` +
      `- DB writes/sec: ${report.summary.postgresWritesPerSecond.toFixed(1)}\n` +
      `- Redis peak memory: ${report.summary.redisPeakMemoryMb.toFixed(1)} MB\n` +
      `- Redis peak queue depth: ${report.summary.redisPeakQueueDepth}\n` +
      `- Worker peak CPU: ${report.summary.workerPeakCpuPercent.toFixed(1)}%\n` +
      `- Worker peak memory: ${report.summary.workerPeakMemoryMb.toFixed(1)} MB\n` +
      `- Worker requirement estimate: ${report.summary.workerInstancesEstimate} instance(s)\n` +
      `- Retry volume: ${report.totals.retryVolume}\n` +
      `- Failed-job volume: ${report.summary.failedJobVolume}\n`;
    await Bun.write(`${fileBase}.md`, markdown);

    console.log(markdown);
    console.log(`Report written to ${fileBase}.json and ${fileBase}.md`);

    if (!allTerminal) throw new Error(`Load test exceeded timeout before all campaigns reached a terminal state`);
  } finally {
    worker.kill("SIGTERM");
    fakeMeta.kill("SIGTERM");
    await settleWithTimeout(Promise.allSettled([worker.exited, fakeMeta.exited]));
    try { worker.kill("SIGKILL"); } catch {}
    try { fakeMeta.kill("SIGKILL"); } catch {}
    if (organizationIds.length && process.env.LOAD_KEEP_DATA !== "1") {
      for (const organizationId of organizationIds) {
        await client`DELETE FROM organizations WHERE id = ${organizationId}::uuid`;
      }
    }
    await settleWithTimeout(Promise.allSettled([dispatchQueue.close(), sendQueue.close()]));
    if (redis.status !== "end") await settleWithTimeout(redis.quit());
    await settleWithTimeout(database.client.end());
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
