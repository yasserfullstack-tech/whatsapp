# Scaling and initial capacity guidance

Capacity must be based on measured load tests, not recipient-count marketing claims. The repository contains a fake-Meta load harness with 1k, 10k, 50k, 100k, and 500k scenarios, concurrent campaigns, webhook flood, Redis restart, worker restart, Postgres pressure, and multi-worker tests. A scenario existing in the harness is not evidence that production has passed it.

There is currently no committed result proving a 500,000-recipient production workload. Do not advertise or operate on that assumption until representative staging tests produce reviewed reports at the intended host size, worker topology, database, Valkey limits, and Meta throughput constraints.

## Worker concurrency

Each worker replica starts four BullMQ consumers. Defaults are:

| Queue | Environment variable | Per-replica default |
| --- | --- | ---: |
| recipient sends | `WORKER_CONCURRENCY` | 400 |
| webhook processing | `WEBHOOK_CONCURRENCY` | 100 |
| campaign dispatch/snapshot | `CAMPAIGN_DISPATCH_CONCURRENCY` | 8 |
| contact import | `CONTACT_IMPORT_CONCURRENCY` | 2 |

`DEFAULT_META_MPS=80` is the default dispatch rate limit used by campaign sending; per-number/Meta limits still govern real throughput. Adding replicas multiplies the potential database/Valkey concurrency, so replica count and per-replica concurrency must be tuned together.

Scale workers without publishing additional host ports:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml \
  up -d --scale worker=2 worker
```

Prometheus uses Docker DNS discovery for the `worker` service and will scrape all replica addresses on port 9464.

## Conservative starting point

For an all-in-one VPS containing Caddy, web, API, workers, PostgreSQL, Valkey, Prometheus, and Grafana, an **8 vCPU / 16 GB RAM / 200 GB or larger NVMe** host is a reasonable starting configuration for staging/production validation. It is not a performance guarantee and should be changed based on measured CPU, memory, disk I/O, database connections, queue behavior, and load-test results.

Start staging with one worker replica so bottlenecks are visible. For production validation, test two replicas for process redundancy only if host resources support them. If two replicas create database/Valkey pressure, lower per-replica concurrency before blindly increasing connection or memory limits.

The production Compose defaults PostgreSQL to 200 connections. Leave substantial headroom for web/API/operator activity; do not size worker concurrency from `max_connections` alone because a job may issue multiple/overlapping database operations. Consider a connection pooler only after metrics show connection churn/pressure justifies it.

Valkey defaults to a 1 GB `maxmemory` inside a 1.5 GB container limit with `noeviction`. `noeviction` is deliberate: BullMQ queue keys must not be silently evicted to make room. Alert and add memory/capacity before the limit is reached rather than switching to an eviction policy that can discard queue state.

## Capacity gates

Before increasing load, watch at least:

- sustained host CPU and worker RSS,
- PostgreSQL CPU, disk latency, query latency, and active connections,
- Valkey used memory and queue depth,
- worker active jobs and configured concurrency,
- send throughput and Meta latency/429/5xx rates,
- webhook processing lag,
- failed/delayed jobs and retry volume,
- API p50/p95/p99 latency and error rate,
- CSV import processing rate.

Operational alert thresholds should be set from observed normal behavior. As an initial guardrail, investigate sustained resource/connection/memory use above roughly 70–80% before adding load. That percentage is a safety trigger, not a tested SLO.

## Required performance validation

Use the existing load harness against isolated staging-like infrastructure and fake Meta endpoints:

```bash
bun run load:run -- --scenario=baseline-80 --recipients=10000
bun run load:run -- --scenario=baseline-1000 --recipients=50000
bun run load:webhooks -- --events=100000 --concurrency=500 --timeout-ms=300000
bun apps/load-test/src/chaos.ts --chaos=multi-worker --scenario=baseline-1000 --recipients=10000 --extra-workers=2
```

Progress through larger recipient counts only after the preceding run is healthy. Archive the JSON/Markdown reports outside transient CI, record the exact VPS specs and concurrency values, and review bottlenecks before changing production defaults. A 500k test should be an explicit capacity exercise, not routine CI.

Run the security suite after infrastructure or proxy changes as well, because request-size limits, headers, tenant isolation, authentication boundaries, and public/internal endpoint exposure are part of production capacity and safety.

## Scaling beyond one VPS

The present design intentionally remains a monolith plus worker processes. First scale vertically and tune worker replicas/concurrency. If measurements later show PostgreSQL or Valkey is the host bottleneck, moving that stateful service to a dedicated VPS or managed equivalent can be done without turning the product into microservices or Kubernetes. Make such a move only with a measured reason, tested backup/restore plan, and private network/TLS controls appropriate to the deployment.
