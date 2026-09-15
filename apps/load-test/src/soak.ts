import { mkdir, readdir, rm } from "node:fs/promises";
import { evaluateCampaignThresholds, evaluateSoakThresholds } from "./thresholds";

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function numberArgument(name: string, fallback: number): number {
  const parsed = Number(argument(name));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function integerArgument(name: string, fallback: number): number {
  return Math.max(1, Math.floor(numberArgument(name, fallback)));
}

async function latestCampaignReport(scenario: string, recipients: number): Promise<string | null> {
  const files = await readdir("load-results").catch(() => [] as string[]);
  const file = files
    .filter((name) => name.endsWith(`-${scenario}-${recipients}.json`))
    .sort()
    .at(-1);
  return file ? `load-results/${file}` : null;
}

function numeric(values: Array<number | null | undefined>): number[] {
  return values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function windowAverage(values: number[], side: "first" | "last"): number {
  if (!values.length) return 0;
  const width = Math.max(1, Math.ceil(values.length * 0.2));
  const window = side === "first" ? values.slice(0, width) : values.slice(-width);
  return window.reduce((sum, value) => sum + value, 0) / window.length;
}

function percentile(values: number[], quantile: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
  return sorted[index] ?? 0;
}

async function run(command: string[], env: Record<string, string> = {}): Promise<number> {
  const child = Bun.spawn(command, {
    env: { ...process.env, ...env },
    stdout: "inherit",
    stderr: "inherit",
  });
  return child.exited;
}

async function main() {
  const durationMinutes = numberArgument("duration-minutes", 30);
  const mps = Math.min(1_000, integerArgument("mps", 80));
  const scenario = mps <= 80 ? "baseline-80" : "baseline-1000";
  const calculatedRecipients = Math.ceil(durationMinutes * 60 * mps * 0.95);
  const recipients = integerArgument("recipients", calculatedRecipients);
  const timeoutMs = integerArgument("timeout-ms", Math.ceil(durationMinutes * 60_000 * 2 + 300_000));
  const startedAt = new Date();
  const probePath = `load-results/${startedAt.toISOString().replace(/[:.]/g, "-")}-worker-event-loop.csv`;

  await mkdir("load-results", { recursive: true });
  await rm(probePath, { force: true });

  console.log(JSON.stringify({
    event: "soak-start",
    durationMinutes,
    targetMps: mps,
    recipients,
    thresholds: {
      workerRssGrowthMb: 256,
      redisGrowthMb: 256,
      postgresConnectionGrowth: 20,
      queueDepthGrowth: 5_000,
      eventLoopP95Ms: 100,
      eventLoopGrowthMs: 50,
    },
  }));

  const exitCode = await run([
    "bun",
    "apps/load-test/src/run.ts",
    `--scenario=${scenario}`,
    `--recipients=${recipients}`,
    `--mps=${mps}`,
    `--timeout-ms=${timeoutMs}`,
  ], {
    LOAD_WORKER_EVENT_LOOP_FILE: probePath,
  });

  const reportPath = await latestCampaignReport(scenario, recipients);
  if (!reportPath) throw new Error("Soak campaign did not produce a JSON report");
  const campaign = await Bun.file(reportPath).json() as any;
  const samples = Array.isArray(campaign.samples) ? campaign.samples : [];
  const workerMemory = numeric(samples.map((sample: any) => sample.workerMemoryMb));
  const redisMemoryMb = numeric(samples.map((sample: any) => Number(sample.redisMemoryBytes) / 1024 / 1024));
  const postgresConnections = numeric(samples.map((sample: any) => Number(sample.postgresConnections)));
  const queueDepth = numeric(samples.map((sample: any) => Number(sample.queueDepth)));

  const eventLoopText = await Bun.file(probePath).text().catch(() => "");
  const eventLoopLag = eventLoopText
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => Number(line.split(",")[1]))
    .filter((value) => Number.isFinite(value));

  // The preload samples once per second. Requiring at least half of the target
  // duration makes a missing/unwritable probe a hard failure while still allowing
  // for setup and teardown time around the actual campaign run.
  const minimumEventLoopSamples = Math.max(2, Math.floor(durationMinutes * 60 * 0.5));
  const eventLoopProbeHealthy = eventLoopLag.length >= minimumEventLoopSamples;

  const firstEventLoopWidth = Math.max(1, Math.ceil(eventLoopLag.length * 0.2));
  const firstEventLoop = eventLoopLag.slice(0, firstEventLoopWidth);
  const lastEventLoop = eventLoopLag.slice(-firstEventLoopWidth);

  const trend = {
    workerRssGrowthMb: windowAverage(workerMemory, "last") - windowAverage(workerMemory, "first"),
    redisGrowthMb: windowAverage(redisMemoryMb, "last") - windowAverage(redisMemoryMb, "first"),
    postgresConnectionGrowth: windowAverage(postgresConnections, "last") - windowAverage(postgresConnections, "first"),
    queueDepthGrowth: windowAverage(queueDepth, "last") - windowAverage(queueDepth, "first"),
    eventLoopP95Ms: percentile(eventLoopLag, 0.95),
    eventLoopGrowthMs: percentile(lastEventLoop, 0.95) - percentile(firstEventLoop, 0.95),
  };

  const campaignThresholds = evaluateCampaignThresholds(campaign);
  const soakThresholds = evaluateSoakThresholds(trend);
  const passed = exitCode === 0 && campaignThresholds.passed && soakThresholds.passed && eventLoopProbeHealthy;
  const finishedAt = new Date();
  const report = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMinutes,
    targetMps: mps,
    recipients,
    commandExitCode: exitCode,
    campaignReport: reportPath,
    eventLoopProbe: probePath,
    eventLoopProbeSamples: eventLoopLag.length,
    minimumEventLoopSamples,
    eventLoopProbeHealthy,
    trend,
    campaignThresholds,
    soakThresholds,
    peaks: {
      workerRssMb: Math.max(0, ...workerMemory),
      redisMemoryMb: Math.max(0, ...redisMemoryMb),
      postgresConnections: Math.max(0, ...postgresConnections),
      queueDepth: Math.max(0, ...queueDepth),
      eventLoopLagP99Ms: percentile(eventLoopLag, 0.99),
    },
    passed,
  };

  const base = `load-results/${startedAt.toISOString().replace(/[:.]/g, "-")}-soak-${durationMinutes}m-${mps}mps`;
  await Bun.write(`${base}.json`, JSON.stringify(report, null, 2));
  const checks = [...campaignThresholds.checks, ...soakThresholds.checks]
    .map((check) => `- ${check.pass ? "PASS" : "FAIL"} — ${check.metric}: ${check.observed} ${check.operator} ${check.limit}`)
    .join("\n");
  const markdown = `# Soak test report\n\n` +
    `- Duration target: ${durationMinutes} minutes\n` +
    `- Target MPS: ${mps}\n` +
    `- Recipients: ${recipients.toLocaleString()}\n` +
    `- Result: ${passed ? "PASS" : "FAIL"}\n` +
    `- Worker RSS growth: ${trend.workerRssGrowthMb.toFixed(1)} MB\n` +
    `- Valkey memory growth: ${trend.redisGrowthMb.toFixed(1)} MB\n` +
    `- Postgres connection growth: ${trend.postgresConnectionGrowth.toFixed(1)}\n` +
    `- Queue-depth growth: ${trend.queueDepthGrowth.toFixed(1)}\n` +
    `- Worker event-loop samples: ${eventLoopLag.length} / minimum ${minimumEventLoopSamples} (${eventLoopProbeHealthy ? "PASS" : "FAIL"})\n` +
    `- Worker event-loop p95: ${trend.eventLoopP95Ms.toFixed(1)} ms\n` +
    `- Worker event-loop p95 growth: ${trend.eventLoopGrowthMs.toFixed(1)} ms\n\n` +
    `## Thresholds\n\n${checks}\n`;
  await Bun.write(`${base}.md`, markdown);
  console.log(markdown);
  console.log(`Soak report: ${base}.json and ${base}.md`);

  await run(["bun", "run", "load:infra:down"]);
  if (!passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});