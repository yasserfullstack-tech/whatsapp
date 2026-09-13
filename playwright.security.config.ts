import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/security",
  testMatch: /.*\.e2e\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "html",
  use: {
    baseURL: "http://127.0.0.1:3000",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "bun run --filter @wa/web start",
    url: "http://127.0.0.1:3000/sign-in",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "security-api",
      use: { browserName: "chromium" },
    },
  ],
});
