# Load testing

This branch load-tests the real campaign snapshot, BullMQ dispatch/send queues, Redis rate limiter, worker, webhook pipeline, and Postgres writes while replacing Meta with a local fake Graph API. The load harness refuses non-local Postgres and Redis URLs unless `LOAD_ALLOW_REMOTE=1` is explicitly set.

## Safety boundary

The campaign runner starts a dedicated worker with a Bun preload that intercepts only `graph.facebook.com/<version>/<phone>/messages` requests and rewrites those sends to `http://127.0.0.1:4100`. Production Meta code is not modified. The preload itself refuses non-local fake endpoints unless `LOAD_ALLOW_REMOTE=1` is explicitly set.

The webhook-flood runner uses the same preload for its worker. Even though the webhook test does not intentionally enqueue campaign sends, any unexpected WhatsApp `/messages` request is redirected to localhost instead of Meta.

The resilience runner goes further: it refuses remote Postgres and Redis URLs entirely, uses `docker-compose.load-chaos.yml`, and tears down its durable local volumes after every run. Its controlled worker-exit hook is active only when `NODE_ENV=test` and `LOAD_WORKER_EXIT_AFTER_MS` is a positive number.

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

## Resilience scenarios

These runs are intentionally separate from normal CI and the routine load-smoke workflow because they restart local dependencies or change worker topology. Use the direct runner so the destructive behavior is explicit:

```bash
bun apps/load-test/src/chaos.ts --chaos=redis-restart --scenario=baseline-1000 --recipients=10000
bun apps/load-test/src/chaos.ts --chaos=worker-restart --scenario=baseline-1000 --recipients=10000
bun apps/load-test/src/chaos.ts --chaos=postgres-pressure --scenario=baseline-1000 --recipients=10000
bun apps/load-test/src/chaos.ts --chaos=multi-worker --scenario=baseline-1000 --recipients=10000 --extra-workers=2
```

`redis-restart` uses append-only local Valkey storage so queued jobs survive the restart. `worker-restart` asks the test-only preload to exit the original worker after the configured fault delay, then starts a replacement worker against the same queues. `postgres-pressure` runs concurrent aggregate scans inside the isolated Postgres container while the campaign is active. `multi-worker` adds repeatable extra worker processes to the same queues so scaling behavior can be compared with the single-worker baseline.

Useful resilience overrides are `--fault-after-ms`, `--extra-workers`, `--mps`, `--worker-concurrency`, and `--timeout-ms`.

## Metrics currently captured

The campaign report records snapshot completion timing, time-to-first-message, stable submitted throughput, fake-Meta p50/p95/p99 latency, Redis memory, send-queue depth, Postgres CPU when Docker stats are available, Postgres connections, approximate database writes/sec, worker CPU and RSS, retry volume, and failed-job volume.

The resilience runner writes a separate JSON/Markdown event timeline alongside the underlying campaign report so the injected fault can be correlated with queue depth, throughput, latency, retries, failures, and worker resource peaks.

## Root cause: Load Smoke failure on `main` @ 149cc1a (issue #90)

Failing run: https://github.com/yasserfullstack-tech/whatsapp/actions/runs/35209808796 (job `smoke`, step `1k campaign smoke`).

**Failing command**

```
bun run load:run -- --scenario=baseline-80 --recipients=1000 --timeout-ms=120000
```

**Failing assertion, quoted from the run log**

```
@wa/load-test run: 533 |     if (!allTerminal) throw new Error(`Load test exceeded timeout before all campaigns reached a terminal state`);
@wa/load-test run:                                       ^
@wa/load-test run: error: Load test exceeded timeout before all campaigns reached a terminal state
@wa/load-test run:       at main (/home/runner/work/whatsapp/whatsapp/apps/load-test/src/run.ts:533:33)
```

That assertion was only the symptom. Every send job in the same run logged:

```
{"jobId":"send-...","organizationId":"fab231fe-250d-4ffd-a1f8-6c11281307d5",
 "campaignId":"acaa2ac0-1fc8-4e52-bb60-68e3a8d0d5f5","recipientId":"...",
 "error":{"name":"BillingEntitlementError",
          "message":"Billing entitlement monthly_campaign_recipients denied: no_subscription"}}
```

**Cause**

`claimSendJob` in `apps/worker/src/campaign-security.ts:50` meters every recipient against the
`monthly_campaign_recipients` entitlement before the provider call, and on a `BillingEntitlementError`
it returns the recipient to `pending` and sets the campaign to `paused`
(`apps/worker/src/campaign-security.ts:89`). That enforcement arrived in `e224e91`
("PR-007: Enforce server-side entitlements and usage limits"), which did not update the load harness.

Migration `0005_billing-foundation.sql` backfills a `starter` subscription only for organizations that
existed when the migration ran. The load harness creates its synthetic organizations *after* migration,
so they have no billing account and no subscription — `getCurrentSubscription` returns `null` and every
send is denied. The campaign then sat in `paused`, which is not in the runner's terminal set
(`completed`, `failed`, `cancelled`), so the runner burned the full 120 s deadline and reported the
generic timeout instead of the denial. Artifact upload "failed" because the workflow had no upload step
at all.

No threshold was weakened. The load thresholds were never reached — zero messages were submitted.

**Fix**

- `apps/load-test/src/run.ts:270-292` — seed a billing account plus an `active` subscription on the
  `custom` plan for each synthetic organization. `custom` has `NULL` entitlement limits, so a plan quota
  cannot mask the metric under test while the metering write path (usage ledger + period usage) is still
  exercised end to end. Change the plan code if a run should deliberately exercise `limit_exceeded`.
- `apps/load-test/src/run.ts:415-427, 401, 455, 570` — detect a `paused` campaign, break out of the poll
  loop immediately, still write the report, then fail with the first recipient `error_code` /
  `last_error` instead of a 120 s generic timeout.
- `.github/workflows/load-smoke.yml:21-33` — dump `docker compose` logs into `load-results/` and upload
  `load-results/` with `if: always()`, so reports and container logs survive a failing test step.

**Reproduction status**

Not reproduced locally: no Docker daemon is available in this environment
(`dial unix /var/run/docker.sock: connect: no such file or directory`) and the harness requires the
`docker-compose.load.yml` Postgres and Valkey services. The cause is established from the run log above
plus the code paths cited. Verification is the Load Smoke workflow run on the fixing commit.
