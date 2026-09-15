import { delimiter, resolve } from "node:path";
import { createRedisClient } from "../../packages/queue/src/index";

const root = resolve(import.meta.dir, "../..");
const nodePath = [resolve(root, "packages/db/node_modules"), process.env.NODE_PATH]
  .filter((value): value is string => Boolean(value))
  .join(delimiter);
const e2eEnv = { ...process.env, NODE_PATH: nodePath };

async function run(command: string[], label: string, extraEnv: Record<string, string> = {}) {
  console.log(`[e2e] ${label}`);
  const child = Bun.spawn(command, {
    cwd: root,
    env: { ...e2eEnv, ...extraEnv },
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  const code = await child.exited;
  if (code !== 0) process.exit(code || 1);
}

async function resetLocalTestRedis() {
  const redisUrl = e2eEnv.REDIS_URL;
  if (!redisUrl) throw new Error("REDIS_URL is required for E2E suite isolation");
  const hostname = new URL(redisUrl).hostname;
  if (!["127.0.0.1", "localhost", "::1"].includes(hostname)) {
    throw new Error(`Refusing to flush non-loopback Redis for E2E isolation: ${hostname}`);
  }
  const redis = createRedisClient(redisUrl);
  try {
    await redis.connect();
    await redis.flushdb();
  } finally {
    await redis.quit().catch(() => undefined);
  }
}

if (!process.env.CI && process.env.E2E_MANAGE_INFRA !== "0") {
  await run(["docker", "compose", "up", "-d", "--wait", "postgres", "valkey"], "starting PostgreSQL and Valkey");
}

await run(["playwright", "test"], "running functional/responsive browser suite", { E2E_ALLOW_LOCAL_STORAGE_CONNECT: "1" });
await resetLocalTestRedis();
await run(["playwright", "test", "-c", "playwright.security.config.ts"], "running browser security suite", { E2E_ALLOW_LOCAL_STORAGE_CONNECT: "0" });
