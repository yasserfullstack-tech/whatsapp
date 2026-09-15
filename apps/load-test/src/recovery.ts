import { mkdir, readdir } from "node:fs/promises";
import { evaluateCampaignThresholds, summarizeThresholds, type ThresholdCheck } from "./thresholds";

const FAKE_META_URL = "http://127.0.0.1:4100";

type RecoveryMode = "429" | "500" | "mixed";

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function integerArgument(name: string, fallback: number): number {
  const parsed = Number(argument(name));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function waitForHttp(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Child load runner is still starting its isolated fake Meta service.
    }
    await Bun.sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function latestReport(recipients: number, startedAt: Date): Promise<string | null> {
  const files = await readdir("load-results").catch(() => [] as string[]);
  const candidates = files
    .filter((name) => name.endsWith(`-baseline-1000-${recipients}.json`))
    .sort()
    .reverse();

  for (const name of candidates) {
    const path = `load-results/${name}`;
    try {
      const report = await Bun.file(path).json() as any;
      const reportStartedAt = Date.parse(String(report?.startedAt ?? ""));
      if (Number.isFinite(reportStartedAt) && reportStartedAt >= startedAt.getTime() - 5_000) return path;
    } catch {
      // Ignore incomplete/stale artifacts and keep looking.
    }
  }
  return null;
}

function check(metric: string, observed: number, operator: "<=" | ">=" | "=", limit: number): ThresholdCheck {
  const pass = operator === "<=" ? observed <= limit : operator === ">=" ? observed >= limit : observed === limit;
  return { metric, observed, operator, limit, pass };
}

async function settleChild(child: ReturnType<typeof Bun.spawn>, timeoutMs = 5_000): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([child.exited.then(() => undefined), Bun.sleep(timeoutMs)]);
  if (child.exitCode === null) {
    try { child.kill("SIGKILL"); } catch {}
  }
}

async function main() {
  const mode = (argument("mode") ?? "429") as RecoveryMode;
  if (!["429", "500", "mixed"].includes(mode)) throw new Error("--mode must be 429, 500, or mixed");
  const recipients = integerArgument("recipients", 10_000);
  const faultAfterMs = integerArgument("fault-after-ms", 5_000);
  const timeoutMs = integerArgument("timeout-ms", 300_000);
  const runnerTimeoutMs = integerArgument("runner-timeout-ms", timeoutMs + 30_000);
  const startedAt = new Date();
  const rates = mode === "429"
    ? { rate429: 1, rate500: 0 }
    : mode === "500"
      ? { rate429: 0, rate500: 1 }
      : { rate429: 0.5, rate500: 0.5 };

  await mkdir("load-results", { recursive: true });
  console.log(JSON.stringify({
    event: "fault-recovery-thresholds-defined",
    mode,
    recipients,
    faultAfterMs,
    timeoutMs,
    runnerTimeoutMs,
    maxAttemptsPerRecipient: 6,
    requiredFinalFailures: 0,
    requiredDuplicateSuccessfulSubmissions: 0,
    minimumRetryVolume: 1,
    minimumMedianRetryGapMs: 750,
  }));

  const child = Bun.spawn([
    "bun",
    "apps/load-test/src/run.ts",
    "--scenario=baseline-1000",
    `--recipients=${recipients}`,
    `--429-rate=${rates.rate429}`,
    `--500-rate=${rates.rate500}`,
    `--timeout-ms=${timeoutMs}`,
  ], {
    env: { ...process.env },
    stdout: "inherit",
    stderr: "inherit",
  });

  let recoveredAt: Date | null = null;
  try {
    await waitForHttp(`${FAKE_META_URL}/health`, Math.min(60_000, runnerTimeoutMs));
    await Bun.sleep(faultAfterMs);
    recoveredAt = new Date();
    const response = await fetch(`${FAKE_META_URL}/__control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rateLimitRate: 0, serverErrorRate: 0, errorRate: 0 }),
    });
    if (!response.ok) throw new Error(`Could not clear fake-Meta fault: ${response.status}`);
    console.log(JSON.stringify({ event: "fake-meta-recovered", at: recoveredAt.toISOString(), mode }));
  } catch (error) {
    await settleChild(child);
    throw error;
  }

  const childOutcome = await Promise.race([
    child.exited.then((code) => ({ kind: "exit" as const, code })),
    Bun.sleep(runnerTimeoutMs).then(() => ({ kind: "timeout" as const, code: 124 })),
  ]);
  if (childOutcome.kind === "timeout") {
    console.error(`Recovery runner exceeded ${runnerTimeoutMs} ms; terminating child load run`);
    await settleChild(child);
  }
  const exitCode = childOutcome.code;
  const reportPath = await latestReport(recipients, startedAt);

  if (!reportPath) {
    const base = `load-results/${startedAt.toISOString().replace(/[:.]/g, "-")}-recovery-${mode}`;
    const failure = {
      mode,
      recipients,
      faultAfterMs,
      startedAt: startedAt.toISOString(),
      recoveredAt: recoveredAt?.toISOString() ?? null,
      finishedAt: new Date().toISOString(),
      commandExitCode: exitCode,
      runnerTimedOut: childOutcome.kind === "timeout",
      passed: false,
      error: "Fault recovery run did not produce a current campaign report",
    };
    await Bun.write(`${base}.json`, JSON.stringify(failure, null, 2));
    await Bun.write(`${base}.md`, `# Meta ${mode} recovery report\n\n- Recipients: ${recipients.toLocaleString()}\n- Result: FAIL\n- Child exit: ${exitCode}\n- Runner timeout: ${childOutcome.kind === "timeout" ? "yes" : "no"}\n- Error: ${failure.error}\n`);
    console.error(failure.error);
    process.exitCode = 1;
    return;
  }

  const campaign = await Bun.file(reportPath).json() as any;
  const campaignThresholds = evaluateCampaignThresholds(campaign);
  const finishedAt = new Date(campaign.finishedAt ?? new Date().toISOString());
  const recoverySeconds = recoveredAt ? Math.max(0, (finishedAt.getTime() - recoveredAt.getTime()) / 1_000) : Number.POSITIVE_INFINITY;
  const expectedSeconds = recipients / 1_000;
  const recoveryLimitSeconds = Math.max(45, expectedSeconds * 4 + 30);
  const recoveryChecks = summarizeThresholds([
    check("terminal recipient failures after recovery", Number(campaign?.totals?.failed ?? 0), "=", 0),
    check("duplicate successful submissions", Number(campaign?.fakeMeta?.duplicateSuccessfulSubmissions ?? 0), "=", 0),
    check("request amplification", Number(campaign?.fakeMeta?.requests ?? 0), "<=", recipients * 6),
    check("retry volume exercised", Number(campaign?.totals?.retryVolume ?? 0), ">=", 1),
    check("median retry gap ms", Number(campaign?.fakeMeta?.retryGapMs?.p50 ?? 0), ">=", 750),
    check("recovery time seconds", recoverySeconds, "<=", recoveryLimitSeconds),
  ]);
  const passed = exitCode === 0 && campaignThresholds.passed && recoveryChecks.passed;

  const report = {
    mode,
    recipients,
    faultAfterMs,
    startedAt: startedAt.toISOString(),
    recoveredAt: recoveredAt?.toISOString() ?? null,
    finishedAt: finishedAt.toISOString(),
    recoverySeconds,
    recoveryLimitSeconds,
    commandExitCode: exitCode,
    runnerTimedOut: childOutcome.kind === "timeout",
    campaignReport: reportPath,
    fakeMeta: campaign.fakeMeta,
    campaignThresholds,
    recoveryChecks,
    passed,
  };
  const base = `load-results/${startedAt.toISOString().replace(/[:.]/g, "-")}-recovery-${mode}`;
  await Bun.write(`${base}.json`, JSON.stringify(report, null, 2));
  const checks = [...campaignThresholds.checks, ...recoveryChecks.checks]
    .map((item) => `- ${item.pass ? "PASS" : "FAIL"} — ${item.metric}: ${item.observed} ${item.operator} ${item.limit}`)
    .join("\n");
  const markdown = `# Meta ${mode} recovery report\n\n` +
    `- Recipients: ${recipients.toLocaleString()}\n` +
    `- Fault window after fake-Meta startup: ${faultAfterMs} ms\n` +
    `- Recovery time: ${recoverySeconds.toFixed(2)} seconds\n` +
    `- Retry requests: ${Number(campaign?.totals?.retryVolume ?? 0).toLocaleString()}\n` +
    `- Duplicate successful submissions: ${Number(campaign?.fakeMeta?.duplicateSuccessfulSubmissions ?? 0)}\n` +
    `- Final failed recipients: ${Number(campaign?.totals?.failed ?? 0)}\n` +
    `- Result: ${passed ? "PASS" : "FAIL"}\n\n## Thresholds\n\n${checks}\n`;
  await Bun.write(`${base}.md`, markdown);
  console.log(markdown);
  console.log(`Recovery report: ${base}.json and ${base}.md`);

  if (!passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
