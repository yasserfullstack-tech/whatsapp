import { describe, expect, test } from "bun:test";
import { evaluateCampaignThresholds } from "./thresholds";

function report(stableThroughputMps: number) {
  return {
    terminal: true,
    totals: {
      expectedRecipients: 10_000,
      submitted: 10_000,
      failed: 0,
      retryVolume: 0,
    },
    scenario: {
      campaigns: 1,
      organizations: 1,
      phonesPerOrganization: 1,
      messagesPerSecond: 1_000,
      workerConcurrency: 1_200,
    },
    summary: {
      stableThroughputMps,
      snapshotSeconds: 1,
      timeToFirstMessageSeconds: 1,
      workerPeakMemoryMb: 256,
      workerPeakCpuPercent: 100,
      redisPeakMemoryMb: 32,
      postgresPeakConnections: 50,
      postgresWritesPerSecond: 1_000,
      postgresPeakCpuPercent: 200,
      redisPeakQueueDepth: 10_000,
      failedJobVolume: 0,
    },
    campaigns: [
      {
        snapshotMs: 1_000,
        completedMs: 15_000,
      },
    ],
    fakeMeta: {
      requests: 10_000,
      duplicateSuccessfulSubmissions: 0,
      rateLimited: 0,
      serverErrors: 0,
      genericErrors: 0,
      latencyMs: {
        p50: 30,
        p95: 35,
        p99: 40,
      },
    },
  };
}

function throughputCheck(stableThroughputMps: number, throughputMode: "capacity" | "regression") {
  const result = evaluateCampaignThresholds(report(stableThroughputMps), { throughputMode });
  const check = result.checks.find((item) => item.metric.includes("dispatch throughput efficiency"));
  if (!check) throw new Error("throughput threshold check missing");
  return check;
}

describe("campaign throughput threshold modes", () => {
  test("PR regression mode still catches the original severe throughput regression", () => {
    expect(throughputCheck(135.7, "regression")).toMatchObject({
      pass: false,
      limit: 0.2,
    });
  });

  test("PR regression mode tolerates shared-runner variance above the regression floor", () => {
    expect(throughputCheck(225.9, "regression")).toMatchObject({
      pass: true,
      limit: 0.2,
    });
  });

  test("capacity mode keeps the 70% representative throughput gate", () => {
    expect(throughputCheck(625.1, "capacity")).toMatchObject({
      pass: false,
      limit: 0.7,
    });
    expect(throughputCheck(750, "capacity")).toMatchObject({
      pass: true,
      limit: 0.7,
    });
  });
});
