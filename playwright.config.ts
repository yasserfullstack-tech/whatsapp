import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.e2e\.ts/,
  testIgnore: /security\/.*\.e2e\.ts/,
  fullyParallel: false,
  workers: process.env.CI ? 1 : undefined,
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
    { name: "desktop-1440", use: { browserName: "chromium", viewport: { width: 1440, height: 900 } } },
    { name: "tablet-768", use: { browserName: "chromium", viewport: { width: 768, height: 1024 } } },
    { name: "mobile-390", use: { browserName: "chromium", viewport: { width: 390, height: 844 } } },
  ],
});
