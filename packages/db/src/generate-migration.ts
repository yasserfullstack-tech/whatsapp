import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { materializeSnapshots, packSnapshots } from "./snapshot-artifacts";

await materializeSnapshots();

const packageDir = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2).filter((value, index) => !(index === 0 && value === "--"));
const result = spawnSync("bunx", ["drizzle-kit", "generate", ...args], {
  cwd: packageDir,
  env: process.env,
  stdio: "inherit",
});

if (result.status !== 0) process.exit(result.status ?? 1);
await packSnapshots();
