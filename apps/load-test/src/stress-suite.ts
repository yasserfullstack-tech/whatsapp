import { mkdir, readdir } from "node:fs/promises";
import { evaluateCampaignThresholds, evaluateWebhookThresholds, type ThresholdSummary } from "./thresholds";

type CampaignCase = {
  label: string;
  scenario: string;
  recipients: number;
  overrides?: string[];
};

type BenchmarkRow = {
  kind: "campaign" | "webhook";
  label: string;
  scale: number;
  passed: boolean;
  skipped?: boolean;
  commandExitCode: number;
  snapshotSeconds?: number;
  firstMessageSeconds?: number | null;
  queueDrainSeconds?: number;
  throughput?: number;
  p50Ms?: number;
  p95Ms?: number;
  p99Ms?: number;
  queuePeak?: number;
  redisPeakMb?: number;
  postgresConnections?: number;
  postgresWritesPerSecond?: number;
  workerPeakCpuPercent?: number;
  workerPeakMb?: number;
  retries?: number;
  failedJobs?: number;
  failed?: number;
  thresholds: ThresholdSummary | null;
  reportPath?: string;
  error?: string;
};

const PROGRESSIVE_SIZES = [1_000, 10_000, 50_000, 100_000, 500_000] as const;

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function integerArgument(name: string, fallback: number): number {
  const parsed = Number(argument(name));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function campaignCases(profile: string): CampaignCase[] {
  if (profile === "pr") {
    return [
      { label: "1 campaign / 80 MPS / 1k", scenario: "baseline-80", recipients: 1_000 },
      { label: "1 campaign / 1,000 MPS / 1k startup smoke", scenario: "baseline-1000", recipients: 1_000 },
      { label: "1 campaign / 1,000 MPS / 10k sustained", scenario: "baseline-1000", recipients: 10_000 },
    ];
  }

  if (profile === "errors") {
    return [
      { label: "Meta 429 storm", scenario: "meta-429", recipients: 10_000 },
      { label: "Meta 500 storm", scenario: "meta-500", recipients: 10_000 },
      {
        label: "mixed transient Meta errors",
        scenario: "baseline-1000",
        recipients: 10_000,
        overrides: ["--429-rate=0.15", "--500-rate=0.15"],
      },
      { label: "slow Meta", scenario: "slow-meta", recipients: 10_000 },
    ];
  }

  if (profile !== "full") throw new Error("--profile must be pr, errors, or full");

  return [
    { label: "1 campaign / 80 MPS / 1k", scenario: "baseline-80", recipients: 1_000 },
    { label: "1 campaign / 80 MPS / 10k", scenario: "baseline-80", recipients: 10_000 },
    ...PROGRESSIVE_SIZES.map((recipients) => ({
      label: `1 campaign / 1,000 MPS / ${recipients.toLocaleString()}`,
      scenario: "baseline-1000",
      recipients,
    })),
    { label: "10 concurrent campaigns", scenario: "concurrent-10", recipients: 10_000 },
    { label: "multiple organizations / phone numbers", scenario: "multi-org", recipients: 10_000 },
    { label: "slow Meta", scenario: "slow-meta", recipients: 10_000 },
    { label: "Meta 429 storm", scenario: "meta-429", recipients: 10_000 },
    { label: "Meta 500 storm", scenario: "meta-500", recipients: 10_000 },
    {
      label: "mixed transient Meta errors",
      scenario: "baseline-1000",
      recipients: 10_000,
      overrides: ["--429-rate=0.15", "--500-rate=0.15"],
    },
  ];
}

async function run(command: string[], env: Record<string, string> = {}): Promise<number> {
  const child = Bun.spawn(command, {
    env: { ...process.env, ...env },
    stdout: "inherit",
    stderr: "inherit",
  });
  return child.exited;
}

async function latestReport(fragment: string): Promise<string | null> {
  const files = await readdir("load-results").catch(() => [] as string[]);
  const match = files
    .filter((name) => name.endsWith(".json") && name.includes(fragment))
    .sort()
    .at(-1);
  return match ? `load-results/${match}` : null;
}

async function readJson(path: string): Promise<any> {
  return Bun.file(path).json();
}

function campaignQueueDrainSeconds(report: any): number {
  const campaigns = Array.isArray(report?.campaigns) ? report.campaigns : [];
  const completed = campaigns.map((item: any) => Number(item?.completedMs)).filter((value: number) => Number.isFinite(value) && value > 0);
  const snapshots = campaigns.map((item: any) => Number(item?.snapshotMs)).filter((value: number) => Number.isFinite(value) && value > 0);
  if (!completed.length || !snapshots.length) return 0;
  return Math.max(0, (Math.max(...completed) - Math.max(...snapshots)) / 1_000);
}

function markdownTable(rows: BenchmarkRow[]): string {
  const header = "| Scenario | Scale | Result | Snapshot | First msg | Drain | Throughput | p50 | p95 | p99 | Queue | Redis MB | PG conns | DB writes/s | Worker CPU | Worker MB | Retries | Failed jobs | Failed |\n|---|---:|:---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|";
  const body = rows.map((row) => [
    row.label,
    row.scale.toLocaleString(),
    row.skipped ? "SKIP" : row.passed ? "PASS" : "FAIL",
    row.snapshotSeconds === undefined ? "—" : `${row.snapshotSeconds.toFixed(2)}s`,
    row.firstMessageSeconds === undefined || row.firstMessageSeconds === null ? "—" : `${row.firstMessageSeconds.toFixed(2)}s`,
    row.queueDrainSeconds === undefined ? "—" : `${row.queueDrainSeconds.toFixed(2)}s`,
    row.throughput === undefined ? "—" : row.throughput.toFixed(1),
    row.p50Ms === undefined ? "—" : row.p50Ms.toFixed(1),
    row.p95Ms === undefined ? "—" : row.p95Ms.toFixed(1),
    row.p99Ms === undefined ? "—" : row.p99Ms.toFixed(1),
    row.queuePeak === undefined ? "—" : row.queuePeak.toFixed(0),
    row.redisPeakMb === undefined ? "—" : row.redisPeakMb.toFixed(1),
    row.postgresConnections === undefined ? "—" : row.postgresConnections.toFixed(0),
    row.postgresWritesPerSecond === undefined ? "—" : row.postgresWritesPerSecond.toFixed(1),
    row.workerPeakCpuPercent === undefined ? "—" : `${row.workerPeakCpuPercent.toFixed(1)}%`,
    row.workerPeakMb === undefined ? "—" : row.workerPeakMb.toFixed(1),
    row.retries === undefined ? "—" : row.retries.toFixed(0),
    row.failedJobs === undefined ? "—" : row.failedJobs.toFixed(0),
    row.failed === undefined ? "—" : row.failed.toFixed(0),
  ].join(" | ")).map((line) => `| ${line} |`).join("\n");
  return `${header}\n${body}`;
}

function thresholdMarkdown(rows: BenchmarkRow[]): string {
  return rows.map((row) => {
    if (row.skipped) return `### ${row.label}\n\nSKIPPED — ${row.error ?? "A smaller progressive stage failed."}`;
    if (!row.thresholds) return `### ${row.label}\n\nNo structured report was produced. ${row.error ?? ""}`;
    const checks = row.thresholds.checks.map((check) =>
      `- ${check.pass ? "PASS" : "FAIL"} — ${check.metric}: ${check.observed} ${check.operator} ${check.limit}${check.note ? ` — ${check.note}` : ""}`,
    ).join("\n");
    return `### ${row.label}\n\n${checks}`;
  }).join("\n\n");
}

async function main() {
  const profile = argument("profile") ?? "pr";
  const webhookEvents = integerArgument("webhook-events", profile === "full" ? 100_000 : 1_000);
  const webhookConcurrency = integerArgument("webhook-concurrency", profile === "full" ? 500 : 50);
  const cases = campaignCases(profile);
  const rows: BenchmarkRow[] = [];
  const suiteStartedAt = new Date();
  const failFastProgression = profile === "pr" || profile === "full";
  const throughputMode = profile === "pr" ? "regression" : "capacity";
  let campaignProgressionBlocked = false;

  console.log(JSON.stringify({
    event: "stress-thresholds-defined",
    profile,
    progressiveSizes: PROGRESSIVE_SIZES,
    failFastProgression,
    throughputMode,
    note: profile === "pr"
      ? "Every campaign stage is thresholded. PR runs on variable shared GitHub runners, so sustained throughput uses a regression floor; representative capacity remains gated by the dedicated full benchmark."
      : "Every campaign stage is thresholded. Full capacity progression stops before larger campaign stages after the first failed campaign benchmark. Throughput is capacity-gated only when the workload represents at least 10 seconds at target MPS.",
  }));

  await mkdir("load-results", { recursive: true });

  try {
    for (const testCase of cases) {
      if (campaignProgressionBlocked) {
        rows.push({
          kind: "campaign",
          label: testCase.label,
          scale: testCase.recipients,
          passed: false,
          skipped: true,
          commandExitCode: 0,
          thresholds: null,
          error: "A smaller campaign stage failed its command or thresholds; larger/heavier campaign stages are not executed.",
        });
        continue;
      }

      console.log(`\n=== ${testCase.label} ===`);
      const command = [
        "bun",
        "apps/load-test/src/run.ts",
        `--scenario=${testCase.scenario}`,
        `--recipients=${testCase.recipients}`,
        ...(testCase.overrides ?? []),
      ];
      const exitCode = await run(command);
      const reportPath = await latestReport(`-${testCase.scenario}-${testCase.recipients}.json`);
      if (!reportPath) {
        rows.push({
          kind: "campaign",
          label: testCase.label,
          scale: testCase.recipients,
          passed: false,
          commandExitCode: exitCode,
          thresholds: null,
          error: "Campaign runner did not produce a JSON report.",
        });
        if (failFastProgression) campaignProgressionBlocked = true;
        continue;
      }

      const report = await readJson(reportPath);
      const thresholds = evaluateCampaignThresholds(report, { throughputMode });
      const passed = exitCode === 0 && thresholds.passed;
      rows.push({
        kind: "campaign",
        label: testCase.label,
        scale: Number(report?.totals?.expectedRecipients ?? testCase.recipients),
        passed,
        commandExitCode: exitCode,
        snapshotSeconds: Number(report?.summary?.snapshotSeconds ?? 0),
        firstMessageSeconds: report?.summary?.timeToFirstMessageSeconds ?? null,
        queueDrainSeconds: campaignQueueDrainSeconds(report),
        throughput: Number(report?.summary?.stableThroughputMps ?? 0),
        p50Ms: Number(report?.fakeMeta?.latencyMs?.p50 ?? 0),
        p95Ms: Number(report?.fakeMeta?.latencyMs?.p95 ?? 0),
        p99Ms: Number(report?.fakeMeta?.latencyMs?.p99 ?? 0),
        queuePeak: Number(report?.summary?.redisPeakQueueDepth ?? 0),
        redisPeakMb: Number(report?.summary?.redisPeakMemoryMb ?? 0),
        postgresConnections: Number(report?.summary?.postgresPeakConnections ?? 0),
        postgresWritesPerSecond: Number(report?.summary?.postgresWritesPerSecond ?? 0),
        workerPeakCpuPercent: Number(report?.summary?.workerPeakCpuPercent ?? 0),
        workerPeakMb: Number(report?.summary?.workerPeakMemoryMb ?? 0),
        retries: Number(report?.totals?.retryVolume ?? 0),
        failedJobs: Number(report?.summary?.failedJobVolume ?? 0),
        failed: Number(report?.totals?.failed ?? 0),
        thresholds,
        reportPath,
      });
      if (failFastProgression && !passed) campaignProgressionBlocked = true;
    }

    console.log(`\n=== signed webhook flood (${webhookEvents.toLocaleString()}) ===`);
    const webhookExit = await run([
      "bun",
      "apps/load-test/src/webhook-flood.ts",
      `--events=${webhookEvents}`,
      `--concurrency=${webhookConcurrency}`,
      `--timeout-ms=${profile === "full" ? 600_000 : 120_000}`,
    ]);
    const webhookPath = await latestReport(`-webhook-flood-${webhookEvents}.json`);
    if (!webhookPath) {
      rows.push({
        kind: "webhook",
        label: "signed webhook flood",
        scale: webhookEvents,
        passed: false,
        commandExitCode: webhookExit,
        thresholds: null,
        error: "Webhook runner did not produce a JSON report.",
      });
    } else {
      const report = await readJson(webhookPath);
      const thresholds = evaluateWebhookThresholds(report);
      rows.push({
        kind: "webhook",
        label: "signed webhook flood",
        scale: webhookEvents,
        passed: webhookExit === 0 && thresholds.passed,
        commandExitCode: webhookExit,
        queueDrainSeconds: Number(report?.totalDrainSeconds ?? 0),
        throughput: Number(report?.ingestRequestsPerSecond ?? 0),
        p50Ms: Number(report?.apiLatencyMs?.p50 ?? 0),
        p95Ms: Number(report?.apiLatencyMs?.p95 ?? 0),
        p99Ms: Number(report?.apiLatencyMs?.p99 ?? 0),
        queuePeak: Number(report?.redisPeakQueueDepth ?? 0),
        redisPeakMb: Number(report?.redisPeakMemoryMb ?? 0),
        workerPeakCpuPercent: Number(report?.workerPeakCpuPercent ?? 0),
        workerPeakMb: Number(report?.workerPeakMemoryMb ?? 0),
        failedJobs: Number(report?.failedJobVolume ?? 0),
        failed: Number(report?.failedJobVolume ?? 0),
        thresholds,
        reportPath: webhookPath,
      });
    }
  } finally {
    await run(["bun", "run", "load:infra:down"]);
  }

  const executedRows = rows.filter((row) => !row.skipped);
  const passed = executedRows.length > 0 && executedRows.every((row) => row.passed);
  const finishedAt = new Date();
  const report = {
    profile,
    startedAt: suiteStartedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    passed,
    rows,
  };
  const base = `load-results/${suiteStartedAt.toISOString().replace(/[:.]/g, "-")}-stress-suite-${profile}`;
  await Bun.write(`${base}.json`, JSON.stringify(report, null, 2));
  const markdown = `# Stress benchmark suite\n\n` +
    `- Profile: ${profile}\n` +
    `- Started: ${suiteStartedAt.toISOString()}\n` +
    `- Finished: ${finishedAt.toISOString()}\n` +
    `- Overall: ${passed ? "PASS" : "FAIL"}\n\n` +
    `${markdownTable(rows)}\n\n## Threshold evaluation\n\n${thresholdMarkdown(rows)}\n`;
  await Bun.write(`${base}.md`, markdown);
  console.log(`\n${markdown}`);
  console.log(`Suite report: ${base}.json and ${base}.md`);

  if (!passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
