import { randomBytes } from "node:crypto";
import { mkdir, readdir } from "node:fs/promises";
import {
  evaluateCampaignThresholds,
  summarizeThresholds,
  type ThresholdCheck,
} from "./thresholds";

type ChaosScenario = "redis-restart" | "worker-restart" | "postgres-pressure" | "multi-worker";

const DEFAULT_DATABASE_URL = "postgres://whatsapp:whatsapp@127.0.0.1:55432/whatsapp_load";
const DEFAULT_REDIS_URL = "redis://127.0.0.1:56379";
const FAKE_META_URL = "http://127.0.0.1:4100";
const COMPOSE = ["docker", "compose", "-f", "docker-compose.load-chaos.yml"];
const WORKER_RESTART_RECOVERY_LIMIT_SECONDS = 90;
let nextExtraWorkerMetricsPort = 19200;

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function numberArgument(name: string, fallback: number): number {
  const value = Number(argument(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function integerArgument(name: string, fallback: number): number {
  return Math.max(1, Math.floor(numberArgument(name, fallback)));
}

function assertLocalUrl(value: string, label: string): void {
  const url = new URL(value);
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error(`${label} must point to localhost. Chaos tests intentionally refuse remote infrastructure.`);
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

async function waitForHttp(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The isolated fake Meta service is still starting.
    }
    await Bun.sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForFakeMetaTrafficProgress(timeoutMs = 120_000): Promise<{ requests: number; inFlight: number }> {
  const deadline = Date.now() + timeoutMs;
  let previousRequests: number | null = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${FAKE_META_URL}/__stats`);
      if (response.ok) {
        const stats = await response.json() as { requests?: number; inFlight?: number };
        const requests = Number(stats.requests ?? 0);
        if (previousRequests !== null && requests > previousRequests) {
          return { requests, inFlight: Number(stats.inFlight ?? 0) };
        }
        previousRequests = requests;
      }
    } catch {
      // Keep polling while the isolated load stack finishes setup or recovers.
    }
    await Bun.sleep(250);
  }
  throw new Error("Timed out waiting for live fake-Meta send traffic; refusing to inject a chaos fault into an idle run");
}

function scenarioDefaults(scenario: string) {
  if (scenario === "baseline-80") return { mps: 80, concurrency: 400 };
  if (scenario === "baseline-1000") return { mps: 1_000, concurrency: 1_200 };
  return { mps: 1_000, concurrency: 1_500 };
}

function thresholdCheck(
  metric: string,
  observed: number,
  operator: "<=" | ">=" | "=",
  limit: number,
  note?: string,
): ThresholdCheck {
  const pass = operator === "<=" ? observed <= limit : operator === ">=" ? observed >= limit : observed === limit;
  return { metric, observed, operator, limit, pass, ...(note ? { note } : {}) };
}

function evaluateWorkerRestartThresholds(campaignReport: any, recoverySeconds: number | null) {
  const generic = evaluateCampaignThresholds(campaignReport);
  const retained = generic.checks.filter((check) =>
    check.metric !== "final recipient failure rate" &&
    check.metric !== "queue drain seconds" &&
    !check.metric.startsWith("dispatch throughput efficiency"),
  );

  const expected = Number(campaignReport?.totals?.expectedRecipients ?? 0);
  const failed = Number(campaignReport?.totals?.failed ?? 0);
  const retries = Number(campaignReport?.totals?.retryVolume ?? 0);
  const requests = Number(campaignReport?.fakeMeta?.requests ?? 0);
  const succeeded = Number(campaignReport?.fakeMeta?.succeeded ?? 0);
  const uniqueSuccessfulRecipients = Number(campaignReport?.fakeMeta?.uniqueSuccessfulRecipients ?? 0);
  const maxInFlight = Number(campaignReport?.fakeMeta?.maxInFlight ?? 0);
  const recovery = recoverySeconds ?? Number.POSITIVE_INFINITY;

  return summarizeThresholds([
    ...retained,
    thresholdCheck(
      "provider requests after worker crash",
      requests,
      "=",
      expected,
      "With no injected Meta faults, every recipient may cross the provider boundary at most once.",
    ),
    thresholdCheck(
      "provider successful submissions after worker crash",
      succeeded,
      "=",
      expected,
      "The fake provider must observe one successful submission for every intended recipient.",
    ),
    thresholdCheck(
      "unique provider successes after worker crash",
      uniqueSuccessfulRecipients,
      "=",
      expected,
      "Every intended recipient must reach the fake provider exactly once.",
    ),
    thresholdCheck(
      "ambiguous recipient outcomes after worker crash",
      failed,
      "<=",
      maxInFlight,
      "A hard crash can lose the response for requests already in flight. Those rows must fail closed instead of being resent.",
    ),
    thresholdCheck(
      "provider retry amplification after worker crash",
      retries,
      "=",
      0,
      "Ambiguous in-flight outcomes must never trigger an automatic provider resend.",
    ),
    thresholdCheck(
      "worker crash recovery seconds",
      recovery,
      "<=",
      WORKER_RESTART_RECOVERY_LIMIT_SECONDS,
      "Bounds stalled-job detection plus replacement-worker recovery without treating the crash interval as a throughput benchmark.",
    ),
  ]);
}

function spawnWorker(input: {
  databaseUrl: string;
  redisUrl: string;
  encryptionKey: string;
  mps: number;
  concurrency: number;
}) {
  const metricsPort = nextExtraWorkerMetricsPort++;
  return Bun.spawn(
    ["bun", "--preload", "./apps/load-test/src/fetch-redirect.ts", "apps/worker/src/index.ts"],
    {
      env: {
        ...process.env,
        NODE_ENV: "test",
        DATABASE_URL: input.databaseUrl,
        REDIS_URL: input.redisUrl,
        CREDENTIAL_ENCRYPTION_KEY: input.encryptionKey,
        META_GRAPH_API_VERSION: "v26.0",
        META_SEND_API_BASE_URL: FAKE_META_URL,
        DEFAULT_META_MPS: String(input.mps),
        WORKER_CONCURRENCY: String(input.concurrency),
        WEBHOOK_CONCURRENCY: "200",
        CAMPAIGN_DISPATCH_CONCURRENCY: "100",
        CONTACT_IMPORT_CONCURRENCY: "2",
        WORKER_METRICS_PORT: String(metricsPort),
        R2_ACCOUNT_ID: "load-test",
        R2_ACCESS_KEY_ID: "load-test",
        R2_SECRET_ACCESS_KEY: "load-test",
        R2_BUCKET: "load-test",
        LOAD_WORKER_EXIT_AFTER_MS: "",
      },
      stdout: "inherit",
      stderr: "inherit",
    },
  );
}

async function injectPostgresPressure(): Promise<void> {
  const script = [
    "set -e",
    "for i in 1 2 3 4 5 6 7 8; do",
    "  psql -U whatsapp -d whatsapp_load -v ON_ERROR_STOP=1 -c 'SELECT sum(v) FROM generate_series(1, 3000000) AS v;' >/dev/null &",
    "done",
    "wait",
  ].join("\n");
  await runCommand(["docker", "exec", "whatsapp-load-postgres", "sh", "-lc", script]);
}

async function latestCampaignReport(scenario: string, recipients: number, afterMs = 0): Promise<string | null> {
  const files = await readdir("load-results").catch(() => [] as string[]);
  const candidates = files
    .filter((name) => name.endsWith(`-${scenario}-${recipients}.json`))
    .sort()
    .reverse();
  for (const name of candidates) {
    const timestamp = Date.parse(name.slice(0, 24).replace(/-(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/, ":$1:$2.$3Z"));
    if (!Number.isFinite(timestamp) || timestamp >= afterMs) return `load-results/${name}`;
  }
  return null;
}

async function readReport(path: string): Promise<any> {
  return Bun.file(path).json();
}

function reportCommand(input: {
  scenario: string;
  recipients: number;
  timeoutMs: number;
  mps: number;
  workerConcurrency: number;
}): string[] {
  return [
    "bun",
    "apps/load-test/src/run.ts",
    `--scenario=${input.scenario}`,
    `--recipients=${input.recipients}`,
    `--timeout-ms=${input.timeoutMs}`,
    `--mps=${input.mps}`,
    `--worker-concurrency=${input.workerConcurrency}`,
  ];
}

async function main() {
  const chaos = argument("chaos") as ChaosScenario | undefined;
  const allowed: ChaosScenario[] = ["redis-restart", "worker-restart", "postgres-pressure", "multi-worker"];
  if (!chaos || !allowed.includes(chaos)) {
    throw new Error(`--chaos is required. Choose ${allowed.join(", ")}`);
  }

  const scenario = argument("scenario") ?? "baseline-1000";
  const recipients = integerArgument("recipients", 10_000);
  const faultAfterMs = integerArgument("fault-after-ms", 5_000);
  const extraWorkers = integerArgument("extra-workers", 2);
  const timeoutMs = integerArgument("timeout-ms", 240_000);
  const defaults = scenarioDefaults(scenario);
  const mps = integerArgument("mps", defaults.mps);
  const workerConcurrency = integerArgument("worker-concurrency", defaults.concurrency);
  const databaseUrl = process.env.LOAD_DATABASE_URL || DEFAULT_DATABASE_URL;
  const redisUrl = process.env.LOAD_REDIS_URL || DEFAULT_REDIS_URL;
  const encryptionKey = process.env.LOAD_CREDENTIAL_ENCRYPTION_KEY || randomBytes(32).toString("base64");

  assertLocalUrl(databaseUrl, "LOAD_DATABASE_URL");
  assertLocalUrl(redisUrl, "LOAD_REDIS_URL");

  const extraChildren: ReturnType<typeof Bun.spawn>[] = [];
  const timeline: Array<Record<string, unknown>> = [];
  const startedAt = new Date();
  let baselineReportPath: string | null = null;
  let baselineReport: any = null;
  let faultRecoveredAt: Date | null = null;

  await mkdir("load-results", { recursive: true });
  await runCommand([...COMPOSE, "up", "-d", "--wait"]);

  const sharedLoadEnv = {
    ...process.env,
    LOAD_MANAGE_INFRA: "0",
    LOAD_DATABASE_URL: databaseUrl,
    LOAD_REDIS_URL: redisUrl,
    LOAD_CREDENTIAL_ENCRYPTION_KEY: encryptionKey,
  };

  try {
    if (chaos === "multi-worker") {
      const baselineStartedAt = Date.now();
      timeline.push({ at: new Date().toISOString(), event: "single-worker-baseline-start" });
      await runCommand(reportCommand({ scenario, recipients, timeoutMs, mps, workerConcurrency }), sharedLoadEnv);
      baselineReportPath = await latestCampaignReport(scenario, recipients, baselineStartedAt);
      if (!baselineReportPath) throw new Error("Multi-worker comparison baseline did not produce a campaign report");
      baselineReport = await readReport(baselineReportPath);
      timeline.push({
        at: new Date().toISOString(),
        event: "single-worker-baseline-complete",
        throughputMps: Number(baselineReport?.summary?.stableThroughputMps ?? 0),
      });
    }

    const chaosLoadStartedAt = Date.now();
    const load = Bun.spawn(
      reportCommand({ scenario, recipients, timeoutMs, mps, workerConcurrency }),
      {
        env: {
          ...sharedLoadEnv,
          ...(chaos === "worker-restart" ? { LOAD_WORKER_EXIT_AFTER_MS: String(faultAfterMs) } : {}),
        },
        stdout: "inherit",
        stderr: "inherit",
      },
    );

    try {
      await waitForHttp(`${FAKE_META_URL}/health`);
      timeline.push({ at: new Date().toISOString(), event: "load-services-ready" });

      const firstTraffic = await waitForFakeMetaTrafficProgress(timeoutMs);
      timeline.push({
        at: new Date().toISOString(),
        event: "live-send-traffic-observed",
        providerRequests: firstTraffic.requests,
        providerInFlight: firstTraffic.inFlight,
      });

      if (chaos !== "worker-restart") {
        await Bun.sleep(faultAfterMs);
        const preFaultTraffic = await waitForFakeMetaTrafficProgress(Math.min(timeoutMs, 30_000));
        timeline.push({
          at: new Date().toISOString(),
          event: "pre-fault-live-traffic-confirmed",
          providerRequests: preFaultTraffic.requests,
          providerInFlight: preFaultTraffic.inFlight,
        });
      }

      if (chaos === "redis-restart") {
        timeline.push({ at: new Date().toISOString(), event: "redis-restart-start" });
        await runCommand([...COMPOSE, "restart", "load-valkey"]);
        faultRecoveredAt = new Date();
        timeline.push({ at: faultRecoveredAt.toISOString(), event: "redis-restart-complete" });
      }

      if (chaos === "worker-restart") {
        await Bun.sleep(faultAfterMs + 1_000);
        const replacement = spawnWorker({ databaseUrl, redisUrl, encryptionKey, mps, concurrency: workerConcurrency });
        extraChildren.push(replacement);
        faultRecoveredAt = new Date();
        timeline.push({ at: faultRecoveredAt.toISOString(), event: "worker-replacement-start", pid: replacement.pid });
      }

      if (chaos === "postgres-pressure") {
        timeline.push({ at: new Date().toISOString(), event: "postgres-pressure-start" });
        await injectPostgresPressure();
        faultRecoveredAt = new Date();
        timeline.push({ at: faultRecoveredAt.toISOString(), event: "postgres-pressure-complete" });
      }

      if (chaos === "multi-worker") {
        for (let index = 0; index < extraWorkers; index += 1) {
          const child = spawnWorker({ databaseUrl, redisUrl, encryptionKey, mps, concurrency: workerConcurrency });
          extraChildren.push(child);
          timeline.push({ at: new Date().toISOString(), event: "extra-worker-start", ordinal: index + 1, pid: child.pid });
        }
        faultRecoveredAt = new Date();
      }

      const exitCode = await load.exited;
      timeline.push({ at: new Date().toISOString(), event: "load-run-exit", exitCode });
      if (exitCode !== 0) throw new Error(`Load run failed with exit code ${exitCode}`);

      const campaignReportPath = await latestCampaignReport(scenario, recipients, chaosLoadStartedAt);
      if (!campaignReportPath) throw new Error("Chaos run did not produce a campaign report");
      const campaignReport = await readReport(campaignReportPath);
      const finishedAt = new Date(campaignReport.finishedAt ?? new Date().toISOString());
      const recoverySeconds = faultRecoveredAt
        ? Math.max(0, (finishedAt.getTime() - faultRecoveredAt.getTime()) / 1_000)
        : null;
      const thresholds = chaos === "worker-restart"
        ? evaluateWorkerRestartThresholds(campaignReport, recoverySeconds)
        : evaluateCampaignThresholds(campaignReport);
      const baselineThroughput = Number(baselineReport?.summary?.stableThroughputMps ?? 0);
      const chaosThroughput = Number(campaignReport?.summary?.stableThroughputMps ?? 0);
      const speedup = baselineThroughput > 0 ? chaosThroughput / baselineThroughput : null;
      const totalWorkers = 1 + (chaos === "multi-worker" ? extraWorkers : 0);
      const linearScalingEfficiency = speedup === null ? null : speedup / totalWorkers;
      const passed = thresholds.passed;
      const workerRestartNote = "A hard worker crash can lose the response for provider requests already in flight. Those outcomes are marked unknown/failed and are not automatically resent, because duplicate WhatsApp delivery is the higher-risk failure mode.";

      const report = {
        chaos,
        scenario,
        recipients,
        faultAfterMs,
        extraWorkers: chaos === "multi-worker" ? extraWorkers : 0,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        timeline,
        campaignReport: campaignReportPath,
        baselineReport: baselineReportPath,
        recoverySeconds,
        throughputMps: chaosThroughput,
        singleWorkerBaselineMps: baselineThroughput || null,
        speedup,
        linearScalingEfficiency,
        note: chaos === "multi-worker"
          ? "Linear scaling can be intentionally capped by per-phone MPS. Compare speedup and contention with scenario topology, not worker count alone."
          : chaos === "worker-restart"
            ? workerRestartNote
            : undefined,
        resourcePeaks: {
          workerCpuPercent: Number(campaignReport?.summary?.workerPeakCpuPercent ?? 0),
          workerRssMb: Number(campaignReport?.summary?.workerPeakMemoryMb ?? 0),
          postgresCpuPercent: Number(campaignReport?.summary?.postgresPeakCpuPercent ?? 0),
          postgresConnections: Number(campaignReport?.summary?.postgresPeakConnections ?? 0),
          postgresWritesPerSecond: Number(campaignReport?.summary?.postgresWritesPerSecond ?? 0),
          valkeyMemoryMb: Number(campaignReport?.summary?.redisPeakMemoryMb ?? 0),
          queueDepth: Number(campaignReport?.summary?.redisPeakQueueDepth ?? 0),
        },
        correctness: {
          expectedRecipients: Number(campaignReport?.totals?.expectedRecipients ?? 0),
          submitted: Number(campaignReport?.totals?.submitted ?? 0),
          failed: Number(campaignReport?.totals?.failed ?? 0),
          ambiguousProviderOutcomes: chaos === "worker-restart" ? Number(campaignReport?.totals?.failed ?? 0) : null,
          providerRequests: Number(campaignReport?.fakeMeta?.requests ?? 0),
          providerSuccessfulSubmissions: Number(campaignReport?.fakeMeta?.succeeded ?? 0),
          uniqueProviderSuccesses: Number(campaignReport?.fakeMeta?.uniqueSuccessfulRecipients ?? 0),
          providerMaxInFlight: Number(campaignReport?.fakeMeta?.maxInFlight ?? 0),
          retries: Number(campaignReport?.totals?.retryVolume ?? 0),
          duplicateSuccessfulSubmissions: Number(campaignReport?.fakeMeta?.duplicateSuccessfulSubmissions ?? 0),
        },
        thresholds,
        outcome: passed ? "passed" : "failed",
      };
      const base = `load-results/${startedAt.toISOString().replace(/[:.]/g, "-")}-chaos-${chaos}`;
      await Bun.write(`${base}.json`, JSON.stringify(report, null, 2));
      const thresholdLines = thresholds.checks
        .map((check) => `- ${check.pass ? "PASS" : "FAIL"} — ${check.metric}: ${check.observed} ${check.operator} ${check.limit}`)
        .join("\n");
      await Bun.write(
        `${base}.md`,
        `# Load chaos report\n\n` +
        `- Chaos: ${chaos}\n` +
        `- Scenario: ${scenario}\n` +
        `- Recipients: ${recipients.toLocaleString()}\n` +
        `- Fault after live traffic: ${faultAfterMs} ms\n` +
        `- Recovery to terminal completion: ${recoverySeconds === null ? "n/a" : `${recoverySeconds.toFixed(2)} s`}\n` +
        `- Throughput: ${chaosThroughput.toFixed(1)} MPS\n` +
        `${speedup === null ? "" : `- Same-host single-worker baseline: ${baselineThroughput.toFixed(1)} MPS\n- Speedup: ${speedup.toFixed(2)}x\n- Linear scaling efficiency: ${(linearScalingEfficiency! * 100).toFixed(1)}%\n`}` +
        `${chaos === "worker-restart" ? `- Ambiguous in-flight outcomes: ${Number(campaignReport?.totals?.failed ?? 0)} / max in-flight ${Number(campaignReport?.fakeMeta?.maxInFlight ?? 0)}\n- Provider unique successes: ${Number(campaignReport?.fakeMeta?.uniqueSuccessfulRecipients ?? 0)} / ${Number(campaignReport?.totals?.expectedRecipients ?? 0)}\n- Crash policy: fail closed; never automatically resend an ambiguous provider success\n` : ""}` +
        `- Duplicate successful submissions: ${Number(campaignReport?.fakeMeta?.duplicateSuccessfulSubmissions ?? 0)}\n` +
        `- Outcome: ${passed ? "PASS" : "FAIL"}\n\n` +
        `## Thresholds\n\n${thresholdLines}\n`,
      );
      console.log(`Chaos report written to ${base}.json and ${base}.md`);
      if (!passed) process.exitCode = 1;
    } finally {
      if (load.exitCode === null) load.kill("SIGTERM");
    }
  } finally {
    for (const child of extraChildren) {
      try { child.kill("SIGTERM"); } catch {}
    }
    await Promise.race([Promise.allSettled(extraChildren.map((child) => child.exited)), Bun.sleep(5_000)]);
    await runCommand([...COMPOSE, "down", "--remove-orphans", "--volumes"]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
