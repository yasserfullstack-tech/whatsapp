# Stress, chaos, and soak validation

This document extends `docs/load-testing.md`. The existing harness remains the implementation foundation; the stress work does not replace it.

## Safety boundary

All campaign stress runs use the real snapshot engine, BullMQ queues, rate limiter, workers, PostgreSQL writes, Valkey, retry logic, and application metrics, but WhatsApp sends are intercepted by `apps/load-test/src/fetch-redirect.ts` and redirected to the local fake Graph API.

`META_SEND_API_BASE_URL` is required to resolve to `localhost`, loopback, or the local `fake-meta` service. The worker preload also blocks any non-redirected request to Meta/Facebook hosts. There is no override that allows a remote Meta send target.

Never use production/customer PostgreSQL or Valkey. Normal load runners reject non-local database/Valkey URLs unless a caller explicitly opts into a controlled remote benchmark environment; chaos and webhook-status tests reject remote infrastructure unconditionally. The GitHub workflows force local load-test URLs and `LOAD_ALLOW_REMOTE=0`.

The fake Meta server records unique successful recipients and duplicate successful submissions. Retries after a 429/500 are expected; a second successful submission for the same recipient is not.

## Pass/fail thresholds

Thresholds are defined before large runs in `apps/load-test/src/thresholds.ts` and are included in JSON/Markdown reports. They are deliberately split between correctness and benchmark safety ceilings.

| Metric | Default threshold |
| --- | ---: |
| Campaigns terminal | 100% |
| Recipients accounted for | 100% |
| Final failure rate without injected Meta faults | 0% |
| Final failure rate with transient fault injection | <= 2% |
| Requests per recipient | <= 6 total attempts |
| Duplicate successful Meta submissions | 0 |
| Baseline dispatch efficiency | >= 70% of configured aggregate MPS for workloads representing >= 10s at target rate |
| Faulted dispatch efficiency | >= 20% of configured aggregate MPS for workloads representing >= 10s at target rate |
| Snapshot duration | <= max(15s, recipients / 5,000) |
| Worker peak RSS safety ceiling | <= 2,048 MB |
| Valkey peak memory safety ceiling | <= 2,048 MB |
| Postgres peak connections | <= 250 |
| Webhook accepted/processed ratio | >= 99.9% |
| Webhook API p95 / p99 | <= 1,000 / 2,500 ms |
| Webhook processing lag p95 / p99 | <= 5,000 / 15,000 ms |
| Webhook failed jobs | 0 |
| Soak worker RSS growth | <= 256 MB |
| Soak Valkey memory growth | <= 256 MB |
| Soak Postgres connection growth | <= 20 |
| Soak queue-depth growth | <= 5,000 |
| Soak worker event-loop lag p95 | <= 100 ms |
| Soak event-loop p95 growth | <= 50 ms |

A very short startup smoke still records throughput, but it is not used as a capacity gate. For example, 1,000 recipients at a 1,000-MPS target represent roughly one second of target traffic, which is dominated by startup/snapshot timing. The PR profile therefore includes a 10,000-recipient 1,000-MPS run to create a minimum 10-second sustained window.

These values are regression gates for the isolated benchmark environment, not a production capacity promise. After VPS/staging runs, record hardware-specific baselines rather than weakening a failing threshold to make a benchmark green.

## Progressive stress suite

Lightweight branch/PR validation:

```bash
bun run load:stress -- --profile=pr --webhook-events=1000 --webhook-concurrency=50
```

The PR profile executes 1,000 at 80 MPS, a 1,000-recipient 1,000-MPS startup smoke, a 10,000-recipient 1,000-MPS sustained baseline, and a 1,000-event signed webhook flood.

Full dedicated-runner suite:

```bash
bun run load:stress -- --profile=full --webhook-events=100000 --webhook-concurrency=500
```

The full profile runs, in order:

1. 1 campaign at 80 MPS with 1,000 and 10,000 recipients.
2. 1 campaign at 1,000 MPS with 1,000, 10,000, 50,000, 100,000, then 500,000 recipients.
3. 10 concurrent campaigns.
4. Multiple organizations and multiple phone numbers.
5. Slow fake Meta.
6. 429 storm.
7. 500 storm.
8. Mixed transient 429/500 errors.
9. A signed webhook flood.

The suite writes an aggregate benchmark table plus each underlying JSON/Markdown report under ignored `load-results/`.

## Retry storms and recovery

The recovery runner starts with fake Meta returning only transient failures, then clears the fault while the same campaign and workers remain active. It verifies bounded six-attempt amplification, exponential retry spacing, zero duplicate successful submissions, zero final failed recipients after recovery, and bounded recovery time.

```bash
bun run load:recovery -- --mode=429 --recipients=10000
bun run load:recovery -- --mode=500 --recipients=10000
bun run load:recovery -- --mode=mixed --recipients=10000
```

For static error-rate benchmarks use:

```bash
bun run load:stress -- --profile=errors
```

## Duplicate, replay, and out-of-order webhook flood

`load:webhook-status` creates real campaign recipients in the isolated database, sends signed webhook payloads through the real API and webhook worker, replays every raw payload exactly once, and deliberately places statuses in this order inside each event:

```text
read -> sent -> failed -> delivered
```

The final recipient state must remain `read`. The durable webhook inbox must contain one event per unique raw payload, despite two accepted HTTP deliveries.

```bash
bun run load:webhook-status -- --recipients=10000 --concurrency=300 --timeout-ms=600000
```

The report includes replay request count, unique durable-event count, processing attempts, dead-letter count, final recipient-state counts, API latency, ingest throughput, and post-ingest drain time.

Malformed webhook structures are intentionally parsed as empty/no-op events rather than treated as poison. Durable dead-letter state is therefore for genuine processing failures (for example persistent DB/application failures), not merely malformed payload shape. The harness does not add a production-only artificial failure hook just to manufacture a poison event.

## Chaos

The existing chaos harness remains the source of Redis/Valkey restart, worker restart, Postgres pressure, and multi-worker tests:

```bash
bun run load:chaos -- --chaos=redis-restart --scenario=baseline-1000 --recipients=10000 --timeout-ms=600000
bun run load:chaos -- --chaos=worker-restart --scenario=baseline-1000 --recipients=10000 --timeout-ms=600000
bun run load:chaos -- --chaos=postgres-pressure --scenario=baseline-1000 --recipients=10000 --timeout-ms=600000
bun run load:chaos -- --chaos=multi-worker --scenario=multi-org --recipients=10000 --extra-workers=2 --fault-after-ms=1000 --timeout-ms=600000
```

`redis-restart` uses the durable local Valkey compose file and verifies work can continue against the persisted queue. `worker-restart` uses the test-only controlled worker exit hook. `postgres-pressure` is restricted to the isolated compose database. Every chaos run consumes the underlying campaign JSON report and applies the normal correctness/resource thresholds, including recipient accounting and duplicate-success checks. Reports include resource peaks and recovery-to-terminal-completion time.

`multi-worker` first runs a same-host, same-scenario single-worker baseline, then runs the extra workers against the same topology and reports speedup and linear-scaling efficiency. Per-phone rate limits can intentionally cap linear speedup, so interpret the result with the scenario's number of organizations and phone numbers rather than expecting worker count alone to multiply throughput.

## Soak

The soak runner keeps one worker alive for the sustained campaign and derives a workload from duration and target MPS. The existing process sampler provides worker RSS, CPU, queue depth, Valkey memory, Postgres connections/writes, and the test-only preload records worker event-loop lag once per second.

Examples:

```bash
# 30 minute local/dedicated baseline
bun run load:soak -- --duration-minutes=30 --mps=80

# 60 minute dedicated runner soak
bun run load:soak -- --duration-minutes=60 --mps=80

# Higher-throughput soak on a suitably sized dedicated runner
bun run load:soak -- --duration-minutes=30 --mps=1000
```

Soak reports compare the first and last 20% of samples for RSS, Valkey memory, Postgres connections, queue depth, and event-loop lag. Positive sustained growth over the thresholds is a leak/degradation signal even when the campaign eventually completes.

## CI strategy

`.github/workflows/stress-soak.yml` has two intentionally different execution classes.

`branch-validation` runs on `ubuntu-latest` only for `test/stress-soak`. It runs:

```bash
bun run test
bun run typecheck
bun run build
bun run load:stress -- --profile=pr ...
bun run load:webhook-status -- --recipients=1000 ...
bun run load:recovery -- --mode=429 --recipients=1000 ...
bun run load:recovery -- --mode=500 --recipients=1000 ...
bun run load:recovery -- --mode=mixed --recipients=1000 ...
bun run load:chaos -- --chaos=redis-restart --scenario=baseline-80 --recipients=1000 ...
bun run load:chaos -- --chaos=worker-restart --scenario=baseline-80 --recipients=1000 ...
```

The dedicated job uses `[self-hosted, linux, x64, stress]`. It supports manual modes `full`, `errors`, `chaos`, `soak`, `recovery`, and `webhook-status`. A weekly schedule runs the `full` profile on that dedicated label.

A meaningful 100k/500k capacity result should come from a stable dedicated runner or staging/VPS host with known CPU, RAM, disk, PostgreSQL, and Valkey configuration. GitHub-hosted runner results are useful regression signals but must not be presented as production capacity.

## Reports and artifacts

Heavy result files stay under `load-results/`, which is gitignored. GitHub Actions uploads them as workflow artifacts. Each runner writes both machine-readable JSON and a Markdown summary. The aggregate stress suite includes a benchmark table and per-scenario threshold evaluation.

Commit only small, reviewed baseline summaries if the hardware and software versions are recorded and the baseline is intended as a regression contract.

## Interpreting 500k

Do not write or publish “supports 500k” merely because a 500k snapshot was created. A support claim requires the full benchmark to pass its correctness and performance thresholds, including no duplicate successful submissions, bounded retry behavior, queue drain, acceptable resource peaks, and recovery testing on representative infrastructure.

VPS/staging validation should record at minimum:

- CPU model/core allocation and memory.
- Disk/storage type and IOPS characteristics.
- PostgreSQL version, `max_connections`, pool limits, CPU/memory, and observed writes/sec.
- Valkey version, persistence mode, `maxmemory`, peak memory, and restart recovery behavior.
- Worker count, per-worker concurrency, peak RSS/CPU, and event-loop lag.
- Snapshot duration, first-send latency, aggregate MPS, queue depth/drain time, and retry amplification.
- Webhook API p50/p95/p99, processing lag p50/p95/p99, and durable inbox/dead-letter counts.

Only after those measurements are available should worker count, DB sizing, and Valkey memory settings be promoted from starting assumptions to production recommendations.
