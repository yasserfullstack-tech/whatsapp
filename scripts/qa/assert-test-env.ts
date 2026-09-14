const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);

if (process.env.QA_DISPOSABLE_INFRA !== "1") {
  throw new Error("QA_DISPOSABLE_INFRA=1 is required. Regression validation must run only against explicitly disposable infrastructure.");
}

function requireLocal(name: "DATABASE_URL" | "REDIS_URL"): URL {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for regression validation`);
  const url = new URL(value);
  if (!localHosts.has(url.hostname)) throw new Error(`${name} must point to local disposable infrastructure, got ${url.hostname}`);
  return url;
}

function assertSynthetic(name: string): void {
  const value = process.env[name];
  if (!value) return;
  if (!value.startsWith("ci-only-") && !value.startsWith("test-only-")) {
    throw new Error(`${name} must be absent or use a ci-only-/test-only- placeholder during regression validation`);
  }
}

function assertLocalEndpoint(name: string): void {
  const value = process.env[name];
  if (!value) return;
  const url = new URL(value);
  if (!localHosts.has(url.hostname)) throw new Error(`${name} must remain local during regression validation, got ${url.hostname}`);
}

const databaseUrl = requireLocal("DATABASE_URL");
requireLocal("REDIS_URL");
const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ""));
if (!databaseName.startsWith("whatsapp_qa_")) {
  throw new Error(`DATABASE_URL must use a dedicated whatsapp_qa_* database, got ${databaseName || "<empty>"}`);
}

if (process.env.LOAD_ALLOW_REMOTE === "1") throw new Error("LOAD_ALLOW_REMOTE=1 is forbidden in the release regression gate");

for (const name of [
  "META_ACCESS_TOKEN",
  "META_APP_SECRET",
  "META_CONFIG_ID",
  "META_VERIFY_TOKEN",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
] as const) {
  assertSynthetic(name);
}

for (const name of ["E2E_META_BASE_URL", "R2_ENDPOINT"] as const) assertLocalEndpoint(name);

console.log(`Regression environment safety boundary passed for disposable database ${databaseName}: local database/cache, local test endpoints, and no real Meta/R2 credentials.`);
