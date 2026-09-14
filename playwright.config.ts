import { defineConfig } from "@playwright/test";

const defaults: Record<string, string> = {
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/whatsapp",
  REDIS_URL: "redis://127.0.0.1:6379",
  BETTER_AUTH_URL: "http://127.0.0.1:3000",
  APP_URL: "http://127.0.0.1:3000",
  BETTER_AUTH_SECRET: "e2e-only-better-auth-secret-that-is-long-enough",
  AUTH_EMAIL_CAPTURE_FILE: "/tmp/wa-e2e-auth-emails.jsonl",
  AUTH_SIGNIN_RATE_LIMIT_MAX: "500",
  AUTH_SIGNUP_RATE_LIMIT_MAX: "500",
  CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  META_APP_ID: "e2e-meta-app",
  META_APP_SECRET: "e2e-meta-secret",
  META_CONFIG_ID: "e2e-meta-config",
  META_VERIFY_TOKEN: "e2e-verify-token",
  META_GRAPH_API_VERSION: "v26.0",
  R2_ACCOUNT_ID: "e2e",
  R2_ACCESS_KEY_ID: "e2e-access",
  R2_SECRET_ACCESS_KEY: "e2e-secret",
  R2_BUCKET: "wa-e2e",
  R2_ENDPOINT: "http://127.0.0.1:4569",
  E2E_META_BASE_URL: "http://127.0.0.1:4777",
  E2E_BLOCK_EXTERNAL: "1",
};

for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) process.env[key] = value;
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.e2e\.ts/,
  testIgnore: /security\/.*\.e2e\.ts/,
  fullyParallel: false,
  workers: process.env.CI ? 1 : undefined,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "html",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://127.0.0.1:3000",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },
  webServer: {
    command: "bun e2e/support/full-stack.ts",
    url: "http://127.0.0.1:3000/sign-in",
    reuseExistingServer: false,
    timeout: 180_000,
    env: { ...process.env } as Record<string, string>,
  },
  projects: [
    { name: "desktop-1440", use: { viewport: { width: 1440, height: 900 } } },
    { name: "tablet-768", use: { viewport: { width: 768, height: 1024 } } },
    { name: "mobile-390", use: { viewport: { width: 390, height: 844 } } },
  ],
});
