import { expect, type Page } from "@playwright/test";

const sdkStub = `
window.FB = {
  init() {},
  login(callback) {
    callback({ status: "connected", authResponse: { code: "e2e-embedded-signup-code" } });
    setTimeout(() => window.dispatchEvent(new MessageEvent("message", {
      origin: "https://www.facebook.com",
      data: { type: "WA_EMBEDDED_SIGNUP", event: "FINISH", data: { waba_id: "e2e-waba", phone_number_id: "e2e-phone", business_id: "e2e-business" } }
    })), 0);
  }
};
if (window.fbAsyncInit) window.fbAsyncInit();
`;

export async function guardBrowser(page: Page) {
  const defects: string[] = [];

  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" && !text.startsWith("Failed to load resource:")) defects.push(`console: ${text}`);
  });
  page.on("pageerror", (error) => defects.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    const errorText = request.failure()?.errorText ?? "";
    if (errorText.includes("ERR_ABORTED")) return;
    const url = new URL(request.url());
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      defects.push(`requestfailed: ${request.method()} ${request.url()} ${errorText}`);
    }
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return;
    const status = response.status();
    const resourceType = response.request().resourceType();
    if (status >= 500 || (status >= 400 && !["fetch", "xhr"].includes(resourceType))) {
      defects.push(`http-${status}: ${response.request().method()} ${response.url()}`);
    }
  });

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "connect.facebook.net") {
      await route.fulfill({ status: 200, contentType: "application/javascript", body: sdkStub });
      return;
    }
    if (url.protocol === "http:" || url.protocol === "https:") {
      if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
        defects.push(`external-request-blocked: ${route.request().method()} ${url.origin}${url.pathname}`);
        await route.fulfill({ status: 204, body: "" });
        return;
      }
    }
    await route.continue();
  });

  return {
    defects,
    async expectHealthy() {
      await expect.poll(() => defects, { timeout: 1_000 }).toEqual([]);
    },
  };
}

export function expectNoHorizontalOverflow(page: Page) {
  return expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}
