# Observability

The platform exposes Prometheus-compatible metrics and structured JSON logs from the API and worker processes.

## Endpoints

API (`API_PORT`, default `4000`):

- `GET /health` — process liveness only.
- `GET /ready` — verifies PostgreSQL and Redis are reachable.
- `GET /metrics` — Prometheus exposition format, including aggregate PostgreSQL execution statistics when `pg_stat_statements` is available.

Worker observability server (`WORKER_METRICS_PORT`, default `9464`):

- `GET /health` — process liveness only.
- `GET /ready` — verifies PostgreSQL and Redis are reachable.
- `GET /metrics` — worker, queue, campaign, webhook, CSV, and Meta API metrics.

Keep `/metrics` and `/ready` private in production. Expose them only to the internal monitoring network or Prometheus scraper.

## Local Prometheus and Grafana

Start the app normally, then run:

```bash
bun run observability:up
```

Prometheus is available on port `9090` and Grafana on port `3001`. The local default Grafana credentials are `admin` / `admin`; set `GRAFANA_ADMIN_USER` and `GRAFANA_ADMIN_PASSWORD` in your local environment to override them.

The Prometheus development config scrapes the host API on `4000` and worker on `9464`. Production deployments should use service discovery or private service DNS instead of `host.docker.internal`.

## PostgreSQL query latency

Database execution latency is derived from PostgreSQL `pg_stat_statements` rather than application SQL logging. This avoids copying SQL parameters or credentials into telemetry and gives cumulative execution time and call counters suitable for Prometheus rate calculations during load tests.

The local PostgreSQL container preloads `pg_stat_statements` and creates the extension for new database volumes. If the database volume already existed before observability was added, enable the extension once:

```bash
docker compose exec postgres psql -U whatsapp -d whatsapp -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements;'
```

Production PostgreSQL must include `pg_stat_statements` in `shared_preload_libraries`, restart PostgreSQL, and run `CREATE EXTENSION pg_stat_statements` in the application database. If the extension is unavailable, `/metrics` still succeeds and exports `whatsapp_db_query_stats_available{database="primary"} 0`.

## Logging policy

Logs are newline-delimited JSON and include correlation fields such as request ID, job ID, campaign ID, organization ID, recipient ID, event ID, and import ID when they are relevant.

The shared logger recursively redacts keys that look like tokens, secrets, passwords, credentials, API keys, encryption keys, cookies, authorization headers, or presigned credentials. It also scrubs bearer tokens and credentials embedded in common connection URLs.

Do not pass raw request bodies, Meta access tokens, encryption keys, passwords, full secrets, credential ciphertext, or presigned credentials to logging calls even with redaction enabled.

## Sentry

Set `SENTRY_DSN` to enable Sentry error reporting in API and worker processes. `SENTRY_ENVIRONMENT` defaults to the process environment and `SENTRY_TRACES_SAMPLE_RATE` defaults to `0.05`.

Sentry is configured with `sendDefaultPii: false`. Before events are sent, request bodies, cookies, query strings, request environment data, user data, and non-allowlisted headers are removed. Structured log context is passed through the same secret redaction used by JSON logs, and exception messages are sanitized before capture.

## Cardinality

Organization, campaign, recipient, and job IDs belong in logs and traces, not Prometheus labels. Metrics intentionally use bounded labels such as queue, state, method, route, status, dependency, operation, and error reason.
