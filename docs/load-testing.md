# Load testing

This branch load-tests the real campaign snapshot, BullMQ dispatch/send queues, Redis rate limiter, worker, webhook pipeline, and Postgres writes while replacing Meta with a local fake Graph API. The load harness refuses non-local Postgres and Redis URLs unless `LOAD_ALLOW_REMOTE=1` is explicitly set.

## Safety boundary

The campaign runner starts a dedicated worker with a Bun preload that intercepts only `graph.facebook.com/<version>/<phone>/messages` requests and rewrites those sends to `http://127.0.0.1:4100`. Production Meta code is not modified. The preload itself refuses non-local fake endpoints unless `LOAD_ALLOW_REMOTE=1` is explicitly set.

The webhook-flood runner uses the same preload for its worker. Even though the webhook test does not intentionally enqueue campaign sends, any unexpected WhatsApp `/messages` request is redirected to localhost instead of Meta.

## Quick start

```bash
bun install
bun run load:run -- --scenario=baseline-80 --recipients=1000
bun run load:run -- --scenario=baseline-1000 --recipients=10000
bun run load:webhooks -- --events=10000 --concurrency=200
```

By default the runners start the isolated `docker-compose.load.yml` Postgres and Valkey services and apply migrations. The campaign runner also starts the fake Meta server, starts a dedicated worker, seeds synthetic organizations/contacts/campaigns, runs the campaign engine, writes reports, and removes the synthetic rows.

Reports are written under `load-results/` as JSON plus Markdown and are intentionally ignored by git.

## Progressive recipient sizes

Run each size separately so resource peaks are attributable to one test:

```bash
bun run load:run -- --scenario=baseline-1000 --recipients=1000
bun run load:run -- --scenario=baseline-1000 --recipients=10000
bun run load:run -- --scenario=baseline-1000 --recipients=50000
bun run load:run -- --scenario=baseline-1000 --recipients=100000
bun run load:run -- --scenario=baseline-1000 --recipients=500000
```

For the 80 MPS path, replace `baseline-1000` with `baseline-80`. A 500k / 80 MPS run is intentionally long; do not use it as a routine CI test.

## Campaign scenario presets

- `baseline-80`: one campaign at 80 MPS.
- `baseline-1000`: one campaign at 1,000 MPS.
- `concurrent-10`: ten campaigns across ten phone numbers with one organization.
- `multi-org`: eight campaigns across four organizations and two phone numbers per organization.
- `slow-meta`: 500 ms base fake-Meta latency plus jitter.
- `meta-429`: 25% of fake-Meta requests return HTTP 429.
- `meta-500`: 25% of fake-Meta requests return HTTP 500.

Any preset can be overridden, for example:

```bash
bun run load:run -- --scenario=meta-429 --recipients=50000 --429-rate=0.50 --latency-ms=100
```

Useful overrides: `--campaigns`, `--organizations`, `--phones`, `--mps`, `--worker-concurrency`, `--latency-ms`, `--jitter-ms`, `--error-rate`, `--429-rate`, `--500-rate`, and `--timeout-ms`.

## Webhook flood

The webhook benchmark sends real HMAC-signed WhatsApp webhook payloads through the API endpoint and the real BullMQ webhook worker. It reports HTTP API p50/p95/p99 latency, accepted and processed counts, ingest rate, end-to-end webhook processing lag p50/p95/p99, queue depth, Redis memory, Postgres CPU, and API/worker CPU and memory.

```bash
bun run load:webhooks -- --events=10000 --concurrency=200
bun run load:webhooks -- --events=100000 --concurrency=500 --timeout-ms=300000
```

The webhook runner flushes the isolated load-test Valkey database before starting. Do not run it concurrently with another load benchmark using the same load-test ports.

## Metrics currently captured

The campaign report records snapshot completion timing, time-to-first-message, stable submitted throughput, fake-Meta p50/p95/p99 latency, Redis memory, send-queue depth, Postgres CPU when Docker stats are available, Postgres connections, approximate database writes/sec, worker CPU and RSS, retry volume, and failed-job volume.

The remaining chaos phase should add Redis restart/recovery, worker crash/restart, deliberate Postgres pressure, and repeatable multi-worker scaling runs. Those tests should remain separate from the normal benchmark path so a routine load run cannot unexpectedly restart infrastructure.
