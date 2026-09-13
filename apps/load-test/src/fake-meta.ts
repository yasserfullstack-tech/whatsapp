type FakeMetaConfig = {
  latencyMs: number;
  jitterMs: number;
  errorRate: number;
  rateLimitRate: number;
  serverErrorRate: number;
  retryAfterMs: number;
};

type FakeMetaState = {
  startedAt: number;
  requests: number;
  succeeded: number;
  genericErrors: number;
  rateLimited: number;
  serverErrors: number;
  inFlight: number;
  maxInFlight: number;
  latencies: number[];
  latencySamplesSeen: number;
};

const clampRate = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const numberFromEnv = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
};

let config: FakeMetaConfig = {
  latencyMs: Math.max(0, numberFromEnv("FAKE_META_LATENCY_MS", 25)),
  jitterMs: Math.max(0, numberFromEnv("FAKE_META_JITTER_MS", 10)),
  errorRate: clampRate(numberFromEnv("FAKE_META_ERROR_RATE", 0)),
  rateLimitRate: clampRate(numberFromEnv("FAKE_META_429_RATE", 0)),
  serverErrorRate: clampRate(numberFromEnv("FAKE_META_500_RATE", 0)),
  retryAfterMs: Math.max(1, numberFromEnv("FAKE_META_RETRY_AFTER_MS", 1_000)),
};

const emptyState = (): FakeMetaState => ({
  startedAt: Date.now(),
  requests: 0,
  succeeded: 0,
  genericErrors: 0,
  rateLimited: 0,
  serverErrors: 0,
  inFlight: 0,
  maxInFlight: 0,
  latencies: [],
  latencySamplesSeen: 0,
});

let state = emptyState();

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const MAX_LATENCY_SAMPLES = 100_000;

function recordLatency(value: number): void {
  state.latencySamplesSeen += 1;
  if (state.latencies.length < MAX_LATENCY_SAMPLES) {
    state.latencies.push(value);
    return;
  }
  const index = Math.floor(Math.random() * state.latencySamplesSeen);
  if (index < MAX_LATENCY_SAMPLES) state.latencies[index] = value;
}

function percentile(sorted: number[], quantile: number): number {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
  return sorted[index] ?? 0;
}

function stats() {
  const sorted = [...state.latencies].sort((a, b) => a - b);
  const elapsedSeconds = Math.max(0.001, (Date.now() - state.startedAt) / 1_000);
  return {
    ...config,
    requests: state.requests,
    succeeded: state.succeeded,
    genericErrors: state.genericErrors,
    rateLimited: state.rateLimited,
    serverErrors: state.serverErrors,
    inFlight: state.inFlight,
    maxInFlight: state.maxInFlight,
    requestsPerSecond: state.requests / elapsedSeconds,
    latencyMs: {
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
      max: sorted.at(-1) ?? 0,
    },
  };
}

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, headers ? { status, headers } : { status });
}

const port = Math.max(1, Math.floor(numberFromEnv("FAKE_META_PORT", 4100)));
const host = process.env.FAKE_META_HOST || "0.0.0.0";

const server = Bun.serve({
  port,
  hostname: host,
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "fake-meta", config });
    }

    if (request.method === "GET" && url.pathname === "/__stats") {
      return json(stats());
    }

    if (request.method === "POST" && url.pathname === "/__reset") {
      state = emptyState();
      return json({ ok: true });
    }

    if (request.method === "POST" && url.pathname === "/__control") {
      const input = await request.json().catch(() => null) as Partial<FakeMetaConfig> | null;
      if (!input || typeof input !== "object") return json({ error: "Invalid JSON body" }, 400);
      config = {
        latencyMs: Math.max(0, Number(input.latencyMs ?? config.latencyMs)),
        jitterMs: Math.max(0, Number(input.jitterMs ?? config.jitterMs)),
        errorRate: clampRate(Number(input.errorRate ?? config.errorRate)),
        rateLimitRate: clampRate(Number(input.rateLimitRate ?? config.rateLimitRate)),
        serverErrorRate: clampRate(Number(input.serverErrorRate ?? config.serverErrorRate)),
        retryAfterMs: Math.max(1, Number(input.retryAfterMs ?? config.retryAfterMs)),
      };
      return json({ ok: true, config });
    }

    const match = url.pathname.match(/^\/v\d+\.\d+\/([^/]+)\/messages$/);
    if (request.method !== "POST" || !match) {
      return json({ error: { message: "Fake Meta endpoint not found", code: 100 } }, 404);
    }

    const startedAt = performance.now();
    state.requests += 1;
    state.inFlight += 1;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);

    try {
      const body = await request.json().catch(() => null) as Record<string, unknown> | null;
      const jitter = config.jitterMs ? Math.random() * config.jitterMs : 0;
      await sleep(config.latencyMs + jitter);

      const roll = Math.random();
      if (roll < config.rateLimitRate) {
        state.rateLimited += 1;
        return json(
          { error: { message: "Load-test rate limit", type: "OAuthException", code: 4, fbtrace_id: "fake-429" } },
          429,
          { "Retry-After": String(Math.ceil(config.retryAfterMs / 1_000)) },
        );
      }

      if (roll < config.rateLimitRate + config.serverErrorRate) {
        state.serverErrors += 1;
        return json({ error: { message: "Load-test upstream error", code: 2, fbtrace_id: "fake-500" } }, 500);
      }

      if (roll < config.rateLimitRate + config.serverErrorRate + config.errorRate) {
        state.genericErrors += 1;
        return json({ error: { message: "Load-test rejected request", code: 131000, fbtrace_id: "fake-400" } }, 400);
      }

      const to = typeof body?.to === "string" ? body.to : "unknown";
      const id = `wamid.load.${Date.now().toString(36)}.${state.requests.toString(36)}`;
      state.succeeded += 1;
      return json({
        messaging_product: "whatsapp",
        contacts: [{ input: to, wa_id: to }],
        messages: [{ id }],
      });
    } finally {
      state.inFlight -= 1;
      recordLatency(performance.now() - startedAt);
    }
  },
});

console.log(`Fake Meta Cloud API listening on ${server.url}`);

const shutdown = () => {
  server.stop(true);
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
