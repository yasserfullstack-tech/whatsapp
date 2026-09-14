import { appendFile } from "node:fs/promises";

const fakeBaseUrl = process.env.META_SEND_API_BASE_URL?.trim();

if (!fakeBaseUrl) {
  throw new Error("META_SEND_API_BASE_URL is required for the load-test worker preload");
}

const target = new URL(fakeBaseUrl);
const localFakeHosts = new Set(["localhost", "127.0.0.1", "::1", "fake-meta"]);
if (!localFakeHosts.has(target.hostname)) {
  throw new Error("META_SEND_API_BASE_URL must point to the local fake Meta service. Remote load-test send targets are forbidden.");
}

const crashAfterMs = Number(process.env.LOAD_WORKER_EXIT_AFTER_MS);
let crashTimerArmed = false;
function armWorkerCrashTimer(): void {
  if (
    crashTimerArmed ||
    process.env.NODE_ENV !== "test" ||
    !Number.isFinite(crashAfterMs) ||
    crashAfterMs <= 0
  ) return;

  crashTimerArmed = true;
  setTimeout(() => {
    console.error(`[load-chaos] intentionally exiting worker ${crashAfterMs}ms after live send traffic began`);
    process.exit(86);
  }, crashAfterMs).unref();
}

const eventLoopProbeFile = process.env.LOAD_WORKER_EVENT_LOOP_FILE?.trim();
if (process.env.NODE_ENV === "test" && eventLoopProbeFile) {
  const intervalMs = 1_000;
  let expected = performance.now() + intervalMs;
  const probe = setInterval(() => {
    const now = performance.now();
    const lagMs = Math.max(0, now - expected);
    expected = now + intervalMs;
    void appendFile(eventLoopProbeFile, `${Date.now()},${lagMs.toFixed(3)}\n`).catch((error) => {
      console.error("[load-soak] could not append worker event-loop probe", error);
    });
  }, intervalMs);
  probe.unref();
}

const originalFetch = globalThis.fetch;

function isMetaHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "graph.facebook.com" ||
    normalized === "facebook.com" ||
    normalized.endsWith(".facebook.com") ||
    normalized === "meta.com" ||
    normalized.endsWith(".meta.com");
}

const redirectFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const originalUrl = input instanceof Request
    ? new URL(input.url)
    : input instanceof URL
      ? new URL(input.href)
      : new URL(input);

  const isWhatsAppSend = originalUrl.hostname === "graph.facebook.com" &&
    /^\/v\d+\.\d+\/[^/]+\/messages$/.test(originalUrl.pathname);

  if (isWhatsAppSend) {
    armWorkerCrashTimer();
    const redirected = new URL(`${originalUrl.pathname}${originalUrl.search}`, target);
    if (input instanceof Request) {
      return originalFetch(new Request(redirected, input), init);
    }
    return originalFetch(redirected, init);
  }

  if (isMetaHost(originalUrl.hostname)) {
    throw new Error(`Blocked real Meta/Facebook request during load testing: ${originalUrl.hostname}${originalUrl.pathname}`);
  }

  return originalFetch(input, init);
};

globalThis.fetch = Object.assign(redirectFetch, {
  preconnect: originalFetch.preconnect,
});
