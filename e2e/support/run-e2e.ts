import { delimiter, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const nodePath = [resolve(root, "packages/db/node_modules"), process.env.NODE_PATH]
  .filter((value): value is string => Boolean(value))
  .join(delimiter);
const e2eEnv = { ...process.env, NODE_PATH: nodePath };

function redisDatabaseUrl(value: string | undefined, database: number): string | undefined {
  if (!value) return value;
  const url = new URL(value);
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") return value;
  url.pathname = `/${database}`;
  return url.toString();
}

async function run(command: string[], label: string, env: Record<string, string | undefined> = e2eEnv) {
  console.log(`[e2e] ${label}`);
  const child = Bun.spawn(command, { cwd: root, env, stdout: "inherit", stderr: "inherit", stdin: "inherit" });
  const code = await child.exited;
  if (code !== 0) process.exit(code || 1);
}

if (!process.env.CI && process.env.E2E_MANAGE_INFRA !== "0") {
  await run(["docker", "compose", "up", "-d", "--wait", "postgres", "valkey"], "starting PostgreSQL and Valkey");
}

await run(["playwright", "test"], "running functional/responsive browser suite");

// Functional browser tests exercise password-reset flows before the security suite.
// Better Auth persists rate-limit counters in Valkey, so a fresh web process alone
// does not provide an isolated throttle state. Keep the security suite on the same
// disposable Valkey instance but use a separate logical database so it proves the
// real max=3 password-reset rule without inheriting counters from the first suite.
const securityEnv = {
  ...e2eEnv,
  REDIS_URL: redisDatabaseUrl(e2eEnv.REDIS_URL, 15),
};
await run(
  ["playwright", "test", "-c", "playwright.security.config.ts"],
  "running browser security suite",
  securityEnv,
);
