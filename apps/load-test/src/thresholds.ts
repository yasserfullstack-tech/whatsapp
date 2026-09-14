export type ThresholdCheck = {
  metric: string;
  observed: number | boolean;
  operator: "<=" | ">=" | "=";
  limit: number | boolean;
  pass: boolean;
  note?: string;
};

export type ThresholdSummary = {
  passed: boolean;
  checks: ThresholdCheck[];
};

function max(metric: string, observed: number, limit: number, note?: string): ThresholdCheck {
  return { metric, observed, operator: "<=", limit, pass: observed <= limit, ...(note ? { note } : {}) };
}

function min(metric: string, observed: number, limit: number, note?: string): ThresholdCheck {
  return { metric, observed, operator: ">=", limit, pass: observed >= limit, ...(note ? { note } : {}) };
}

function equal(metric: string, observed: number | boolean, limit: number | boolean, note?: string): ThresholdCheck {
  return { metric, observed, operator: "=", limit, pass: observed === limit, ...(note ? { note } : {}) };
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function campaignQueueDrainSeconds(report: any): number {
  const campaigns = Array.isArray(report?.campaigns) ? report.campaigns : [];
  const completed = campaigns
    .map((campaign: any) => number(campaign?.completedMs))
    .filter((value: number) => value > 0);
  const snapshots = campaigns
    .map((campaign: any) => number(campaign?.snapshotMs))
    .filter((value: number) => value > 0);
  if (!completed.length || !snapshots.length) return Number.POSITIVE_INFINITY;
  return Math.max(0, (Math.max(...completed) - Math.max(...snapshots)) / 1_000);
}

export function summarizeThresholds(checks: ThresholdCheck[]): ThresholdSummary {
  return { passed: checks.every((check) => check.pass), checks };
}

export function evaluateCampaignThresholds(report: any): ThresholdSummary {
  const expected = number(report?.totals?.expectedRecipients);
  const submitted = number(report?.totals?.submitted);
  const failed = number(report?.totals?.failed);
  const retryVolume = number(report?.totals?.retryVolume);
  const requests = number(report?.fakeMeta?.requests);
  const duplicates = number(report?.fakeMeta?.duplicateSuccessfulSubmissions);
  const transientFailures = number(report?.fakeMeta?.rateLimited) + number(report?.fakeMeta?.serverErrors);
  const genericFailures = number(report?.fakeMeta?.genericErrors);
  const hasInjectedErrors = transientFailures + genericFailures > 0;
  const campaigns = Math.max(1, number(report?.scenario?.campaigns));
  const organizations = Math.max(1, number(report?.scenario?.organizations));
  const phones = Math.max(1, number(report?.scenario?.phonesPerOrganization));
  const targetPerChannel = Math.max(1, number(report?.scenario?.messagesPerSecond));
  const activeChannels = Math.min(campaigns, organizations * phones);
  const targetAggregateMps = targetPerChannel * activeChannels;
  const observedMps = number(report?.summary?.stableThroughputMps);
  const throughputEfficiency = targetAggregateMps > 0 ? observedMps / targetAggregateMps : 0;
  const expectedSteadyStateSeconds = targetAggregateMps > 0 ? expected / targetAggregateMps : 0;
  const hasSustainedThroughputWindow = expectedSteadyStateSeconds >= 10;
  const snapshotSeconds = number(report?.summary?.snapshotSeconds);
  const firstMessageSeconds = report?.summary?.timeToFirstMessageSeconds === null
    ? Number.POSITIVE_INFINITY
    : number(report?.summary?.timeToFirstMessageSeconds);
  const queueDrainSeconds = campaignQueueDrainSeconds(report);
  const workerMemoryMb = number(report?.summary?.workerPeakMemoryMb);
  const workerCpuPercent = number(report?.summary?.workerPeakCpuPercent);
  const redisMemoryMb = number(report?.summary?.redisPeakMemoryMb);
  const dbConnections = number(report?.summary?.postgresPeakConnections);
  const dbWritesPerSecond = number(report?.summary?.postgresWritesPerSecond);
  const dbCpuPercent = number(report?.summary?.postgresPeakCpuPercent);
  const queueDepth = number(report?.summary?.redisPeakQueueDepth);
  const failedJobs = number(report?.summary?.failedJobVolume);
  const metaP50 = number(report?.fakeMeta?.latencyMs?.p50 ?? report?.summary?.apiLatencyMs?.p50);
  const metaP95 = number(report?.fakeMeta?.latencyMs?.p95 ?? report?.summary?.apiLatencyMs?.p95);
  const metaP99 = number(report?.fakeMeta?.latencyMs?.p99 ?? report?.summary?.apiLatencyMs?.p99);
  const snapshotLimitSeconds = Math.max(15, expected / 5_000);
  const finalFailureRate = expected > 0 ? failed / expected : 1;
  const failureRateLimit = hasInjectedErrors ? 0.02 : 0;
  const throughputEfficiencyFloor = hasInjectedErrors ? 0.20 : 0.70;
  const queueDepthLimit = Math.min(expected, 20_000 * campaigns) + Math.max(1, number(report?.scenario?.workerConcurrency));
  const queueDrainLimitSeconds = Math.max(30, expectedSteadyStateSeconds * 4 + 15);
  const failedJobLimit = Math.ceil(expected * failureRateLimit);

  const throughputCheck = hasSustainedThroughputWindow
    ? min(
        "dispatch throughput efficiency",
        throughputEfficiency,
        throughputEfficiencyFloor,
        `Gated because the configured workload represents ${expectedSteadyStateSeconds.toFixed(1)} seconds at target throughput.`,
      )
    : min(
        "dispatch throughput efficiency (short-run diagnostic only)",
        throughputEfficiency,
        0,
        `Not capacity-gated: ${expected.toLocaleString()} recipients represent only ${expectedSteadyStateSeconds.toFixed(1)} seconds at the configured aggregate target. Sustained throughput requires at least a 10-second target window.`,
      );

  const checks: ThresholdCheck[] = [
    equal("all campaigns terminal", Boolean(report?.terminal), true),
    equal("recipients accounted for", submitted + failed, expected),
    max("final recipient failure rate", finalFailureRate, failureRateLimit, hasInjectedErrors
      ? "Transient-error scenarios allow a small bounded terminal-failure rate after the six-attempt send policy."
      : "No terminal recipient failures are allowed without injected upstream faults."),
    max("Meta request amplification", requests, expected * 6, "The send queue has at most six attempts per recipient."),
    max("retry volume", retryVolume, expected * 5, "A recipient can have at most five retries after its initial attempt."),
    equal("duplicate successful Meta submissions", duplicates, 0, "A retry may repeat a failed request, but a recipient must not be successfully submitted twice."),
    throughputCheck,
    max("snapshot duration seconds", snapshotSeconds, snapshotLimitSeconds),
    max("time to first message seconds", firstMessageSeconds, snapshotLimitSeconds + 10),
    max("queue drain seconds", queueDrainSeconds, queueDrainLimitSeconds, "Measured from the last campaign snapshot to terminal campaign completion."),
    max("fake Meta API p50 ms", metaP50, 1_250),
    max("fake Meta API p95 ms", metaP95, 2_000),
    max("fake Meta API p99 ms", metaP99, 3_000),
    max("worker peak CPU percent", workerCpuPercent, 1_000, "Safety ceiling across multi-core runners, not a production sizing target."),
    max("worker peak RSS MB", workerMemoryMb, 2_048, "Safety ceiling for the benchmark process; tune lower on the target VPS after validation."),
    max("Valkey peak memory MB", redisMemoryMb, 2_048, "Safety ceiling, not a production sizing claim."),
    max("Postgres peak CPU percent", dbCpuPercent, 1_000, "Safety ceiling across multi-core runners."),
    max("Postgres peak connections", dbConnections, 250),
    min("Postgres writes per second", dbWritesPerSecond, expected > 0 ? 1 : 0, "Confirms the DB write sampler observed sustained application writes."),
    max("send queue peak depth", queueDepth, queueDepthLimit),
    max("failed send jobs", failedJobs, failedJobLimit),
  ];

  return summarizeThresholds(checks);
}

export function evaluateWebhookThresholds(report: any): ThresholdSummary {
  const events = number(report?.events);
  const accepted = number(report?.accepted);
  const processed = number(report?.processed);
  const ingestRate = number(report?.ingestRequestsPerSecond);
  const totalDrainSeconds = number(report?.totalDrainSeconds);
  const drainLimitSeconds = Math.max(30, events / 250);
  const checks: ThresholdCheck[] = [
    min("webhook accepted ratio", events > 0 ? accepted / events : 0, 0.999),
    min("webhook processed ratio", accepted > 0 ? processed / accepted : 0, 0.999),
    max("webhook HTTP request failures", number(report?.requestFailures), Math.max(0, Math.floor(events * 0.001))),
    max("webhook API p50 ms", number(report?.apiLatencyMs?.p50), 500),
    max("webhook API p95 ms", number(report?.apiLatencyMs?.p95), 1_000),
    max("webhook API p99 ms", number(report?.apiLatencyMs?.p99), 2_500),
    max("webhook processing lag p50 ms", number(report?.webhookLagMs?.p50), 2_500),
    max("webhook processing lag p95 ms", number(report?.webhookLagMs?.p95), 5_000),
    max("webhook processing lag p99 ms", number(report?.webhookLagMs?.p99), 15_000),
    max("webhook total drain seconds", totalDrainSeconds, drainLimitSeconds),
    min("webhook ingest requests per second", ingestRate, events >= 1_000 ? 100 : 1, "Regression floor for the isolated test environment, not a production capacity claim."),
    max("webhook failed jobs", number(report?.failedJobVolume), 0),
    max("webhook queue peak depth", number(report?.redisPeakQueueDepth), events + 1_000),
    max("webhook Valkey peak memory MB", number(report?.redisPeakMemoryMb), 2_048),
    max("webhook worker peak CPU percent", number(report?.workerPeakCpuPercent), 1_000),
    max("webhook worker peak RSS MB", number(report?.workerPeakMemoryMb), 2_048),
    max("webhook API peak CPU percent", number(report?.apiPeakCpuPercent), 1_000),
    max("webhook API peak RSS MB", number(report?.apiPeakMemoryMb), 1_024),
  ];
  return summarizeThresholds(checks);
}

export function evaluateSoakThresholds(input: {
  workerRssGrowthMb: number;
  redisGrowthMb: number;
  postgresConnectionGrowth: number;
  queueDepthGrowth: number;
  eventLoopP95Ms: number;
  eventLoopGrowthMs: number;
}): ThresholdSummary {
  return summarizeThresholds([
    max("worker RSS growth MB", input.workerRssGrowthMb, 256, "First-versus-last window; sustained growth above this is treated as a leak signal."),
    max("Valkey memory growth MB", input.redisGrowthMb, 256),
    max("Postgres connection growth", input.postgresConnectionGrowth, 20),
    max("queue depth growth", input.queueDepthGrowth, 5_000, "A sustained soak should not accumulate an unbounded send backlog."),
    max("worker event-loop lag p95 ms", input.eventLoopP95Ms, 100),
    max("worker event-loop lag growth ms", input.eventLoopGrowthMs, 50),
  ]);
}
