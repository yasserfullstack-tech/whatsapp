import { delimiter, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const nodePath = [resolve(root, "packages/db/node_modules"), process.env.NODE_PATH]
  .filter((value): value is string => Boolean(value))
  .join(delimiter);
const e2eEnv = { ...process.env, NODE_PATH: nodePath };

async function run(command: string[], label: string) {
  console.log(`[e2e] ${label}`);
  const child = Bun.spawn(command, { cwd: root, env: e2eEnv, stdout: "inherit", stderr: "inherit", stdin: "inherit" });
  const code = await child.exited;
  if (code !== 0) process.exit(code || 1);
}

if (!process.env.CI && process.env.E2E_MANAGE_INFRA !== "0") {
  await run(["docker", "compose", "up", "-d", "--wait", "postgres", "valkey"], "starting PostgreSQL and Valkey");
}

await run(["playwright", "test"], "running functional/responsive browser suite");
await run(["playwright", "test", "-c", "playwright.security.config.ts"], "running browser security suite");
