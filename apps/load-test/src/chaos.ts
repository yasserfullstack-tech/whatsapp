import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";

type ChaosScenario = "redis-restart" | "worker-restart" | "postgres-pressure" | "multi-worker";

const DEFAULT_DATABASE_URL = "postgres://whatsapp:whatsapp@127.0.0.1:55432/whatsapp_load";
const DEFAULT_REDIS_URL = "redis://127.0.0.1:56379";
const FAKE_META_URL = "http://127.0.0.1:4100";
const COMPOSE = ["docker", "compose", "-f", "docker-compose.load-chaos.yml"];

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function integerArgument(name: string, fallback: number): number {
  const value = Number(argument(name));
  return Number.isInteger(value) && value > 0 ? value : fallback;
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

function scenarioDefaults(scenario: string) {
  if (scenario === "baseline-80") return { mps: 80, concurrency: 400 };
  if (scenario === "baseline-1000") return { mps: 1_000, concurrency: 1_200 };
  return { mps: 1_000, concurrency: 1_500 };
}

function spawnWorker(input: {
  databaseUrl: string;
  redisUrl: string;
  encryptionKey: string;
  mps: number;
  concurrency: number;
}) {
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

  await runCommand([...COMPOSE, "up", "-d", "--wait"]);

  const load = Bun.spawn(
    [
      "bun",
      "apps/load-test/src/run.ts",
      `--scenario=${scenario}`,
      `--recipients=${recipients}`,
      `--timeout-ms=${timeoutMs}`,
      `--mps=${mps}`,
      `--worker-concurrency=${workerConcurrency}`,
    ],
    {
      env: {
        ...process.env,
        LOAD_MANAGE_INFRA: "0",
        LOAD_DATABASE_URL: databaseUrl,
        LOAD_REDIS_URL: redisUrl,
        LOAD_CREDENTIAL_ENCRYPTION_KEY: encryptionKey,
        ...(chaos === "worker-restart" ? { LOAD_WORKER_EXIT_AFTER_MS: String(faultAfterMs) } : {}),
      },
      stdout: "inherit",
      stderr: "inherit",
    },
  );

  try {
    await waitForHttp(`${FAKE_META_URL}/health`);
    timeline.push({ at: new Date().toISOString(), event: "load-services-ready" });

    if (chaos !== "worker-restart") await Bun.sleep(faultAfterMs);

    if (chaos === "redis-restart") {
      timeline.push({ at: new Date().toISOString(), event: "redis-restart-start" });
      await runCommand([...COMPOSE, "restart", "load-valkey"]);
      timeline.push({ at: new Date().toISOString(), event: "redis-restart-complete" });
    }

    if (chaos === "worker-restart") {
      await Bun.sleep(faultAfterMs + 1_000);
      const replacement = spawnWorker({ databaseUrl, redisUrl, encryptionKey, mps, concurrency: workerConcurrency });
      extraChildren.push(replacement);
      timeline.push({ at: new Date().toISOString(), event: "worker-replacement-start", pid: replacement.pid });
    }

    if (chaos === "postgres-pressure") {
      timeline.push({ at: new Date().toISOString(), event: "postgres-pressure-start" });
      await injectPostgresPressure();
      timeline.push({ at: new Date().toISOString(), event: "postgres-pressure-complete" });
    }

    if (chaos === "multi-worker") {
      for (let index = 0; index < extraWorkers; index += 1) {
        const child = spawnWorker({ databaseUrl, redisUrl, encryptionKey, mps, concurrency: workerConcurrency });
        extraChildren.push(child);
        timeline.push({ at: new Date().toISOString(), event: "extra-worker-start", ordinal: index + 1, pid: child.pid });
      }
    }

    const exitCode = await load.exited;
    timeline.push({ at: new Date().toISOString(), event: "load-run-exit", exitCode });
    if (exitCode !== 0) throw new Error(`Load run failed with exit code ${exitCode}`);

    await mkdir("load-results", { recursive: true });
    const report = {
      chaos,
      scenario,
      recipients,
      faultAfterMs,
      extraWorkers: chaos === "multi-worker" ? extraWorkers : 0,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      timeline,
      outcome: "completed",
    };
    const base = `load-results/${startedAt.toISOString().replace(/[:.]/g, "-")}-chaos-${chaos}`;
    await Bun.write(`${base}.json`, JSON.stringify(report, null, 2));
    await Bun.write(
      `${base}.md`,
      `# Load chaos report\n\n- Chaos: ${chaos}\n- Scenario: ${scenario}\n- Recipients: ${recipients}\n- Fault after: ${faultAfterMs} ms\n- Outcome: completed\n`,
    );
    console.log(`Chaos report written to ${base}.json and ${base}.md`);
  } finally {
    if (load.exitCode === null) load.kill("SIGTERM");
    for (const child of extraChildren) {
      try { child.kill("SIGTERM"); } catch {}
    }
    await Promise.race([Promise.allSettled(extraChildren.map((child) => child.exited)), Bun.sleep(5_000)]);
    await runCommand([...COMPOSE, "down", "--remove-orphans", "--volumes"]);
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
