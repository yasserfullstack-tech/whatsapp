const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);

function requireLocal(name: "DATABASE_URL" | "REDIS_URL"): void {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for regression validation`);
  const url = new URL(value);
  if (!localHosts.has(url.hostname)) throw new Error(`${name} must point to local disposable infrastructure, got ${url.hostname}`);
}

function assertSynthetic(name: string): void {
  const value = process.env[name];
  if (!value) return;
  if (!value.startsWith("ci-only-") && !value.startsWith("test-only-")) {
    throw new Error(`${name} must be absent or use a ci-only-/test-only- placeholder during regression validation`);
  }
}

requireLocal("DATABASE_URL");
requireLocal("REDIS_URL");

if (process.env.LOAD_ALLOW_REMOTE === "1") throw new Error("LOAD_ALLOW_REMOTE=1 is forbidden in the release regression gate");

for (const name of ["META_ACCESS_TOKEN", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"] as const) {
  assertSynthetic(name);
}

console.log("Regression environment safety boundary passed: local database/cache and no real Meta/R2 credentials.");
