# Production deployment

This deployment keeps the existing architecture intentionally simple: Caddy is the public edge, Next.js serves the web application, Hono serves the API, BullMQ workers consume queues, PostgreSQL and Valkey keep durable state, and Cloudflare R2 remains external. It does not introduce Kubernetes or split the application into microservices.

## Host prerequisites

Use a supported Linux VPS with Docker Engine, the Docker Compose plugin, a firewall, DNS for the application domain, and enough disk for PostgreSQL plus operational headroom. Only ports 80 and 443 need to be public. Prometheus and Grafana bind to loopback by default and should be reached through SSH tunneling or another authenticated operator path.

Create the deployment directory from a tagged/reviewed release and create the host-only environment file:

```bash
cp .env.production.example .env.production
chmod 600 .env.production
```

Populate every placeholder with production values. Never commit `.env.production`. Validate interpolation before a rollout:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml config --quiet
```

For real releases, set `WEB_IMAGE`, `API_IMAGE`, `WORKER_IMAGE`, and `MIGRATOR_IMAGE` to immutable registry tags or digests. Reusing `:latest` or mutable tags makes rollback ambiguous.

## First deployment

1. Point `APP_DOMAIN` DNS at the VPS and make sure inbound TCP 80/443 and UDP 443 are allowed.
2. Populate `.env.production` and provision the R2 bucket, Meta application credentials, Resend sender, Sentry project if used, and operator-only Grafana credentials.
3. Start PostgreSQL and Valkey, then run migrations before application rollout.
4. Start the web, API, worker, observability, and Caddy services.
5. Verify readiness, worker queue visibility, and the public smoke test.

Example:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml up -d postgres valkey
docker compose --env-file .env.production -f docker-compose.production.yml --profile ops run --rm migrate
docker compose --env-file .env.production -f docker-compose.production.yml \
  up -d --remove-orphans --scale worker=2 web api worker prometheus grafana caddy

curl --fail https://example.com/ready
infra/production/scripts/smoke-test.sh https://example.com
```

Replace `2` with the worker replica count validated for the host. The worker service has no host-published port, so multiple replicas can share the same Compose project. Prometheus discovers every worker replica through Docker DNS and scrapes port 9464.

## Release flow

Use this order for every production rollout:

1. **Backup the database.** The backup job must finish restore verification and its encrypted off-server copy; a dump file alone is not a completed backup.
2. **Pull or build the release images.** Pin the exact release identifiers.
3. **Run database migrations as a one-off operation.** Stop the rollout if migration fails.
4. **Start/update web, API, workers, Prometheus, Grafana, and Caddy.** Keep PostgreSQL and Valkey persistent volumes intact.
5. **Verify API readiness.** `GET /ready` must return HTTP 200 and both database and Redis checks must be `ok`.
6. **Verify workers.** At least one worker must be healthy and `/metrics` on the private network must expose queue-depth and configured-concurrency metrics.
7. **Verify queues.** Check `whatsapp_queue_depth` in Prometheus/Grafana and investigate unexpected failed/delayed growth before declaring the rollout healthy.
8. **Run the smoke test.** Confirm public HTTPS, `/health`, `/ready`, the web root, HSTS, and that `/metrics` is not public.

Internal checks can be run without exposing operator endpoints:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml exec -T api \
  bun -e "fetch('http://127.0.0.1:4000/ready').then(async r=>{console.log(await r.text());process.exit(r.ok?0:1)})"

docker compose --env-file .env.production -f docker-compose.production.yml exec -T worker \
  bun -e "fetch('http://127.0.0.1:9464/metrics').then(r=>r.text()).then(t=>{console.log(t.match(/whatsapp_queue_depth[^\n]*/g)?.slice(0,8).join('\n')||'queue metrics missing')})"
```

## Caddy and network boundaries

Caddy obtains and renews TLS certificates, explicitly redirects HTTP to HTTPS, compresses responses, applies a request-body ceiling, adds edge security headers, and actively/passively checks upstream health. Next.js remains responsible for its application-specific Content Security Policy so the Meta Embedded Signup allowlist is not accidentally overwritten at the edge.

`/metrics` is intentionally blocked by Caddy. API and worker metrics remain reachable only on the Compose network. PostgreSQL and Valkey do not publish host ports. Grafana and Prometheus bind to `127.0.0.1` by default.

## Database migrations

Run migrations before starting the new application image. A migration can be operationally irreversible even when SQL has a theoretical down path, especially after new code has written data in a new shape.

Prefer expand/contract changes:

1. add nullable columns/tables/indexes or other backward-compatible schema,
2. deploy code that can tolerate old and new shapes,
3. backfill or dual-write if necessary,
4. switch reads after verification,
5. remove old schema only in a later release after the rollback window has passed.

Do not couple a destructive schema contraction to the same release that first stops using the old shape.

## Rollback

Keep the previous image identifiers until the new release has completed its observation window. If the schema is still compatible, set the image variables back to the previous release and run `docker compose up -d` for web/API/workers. Do not automatically reverse a migration as part of application rollback.

If a migration introduced an incompatibility, prefer a forward corrective migration or restore into a separate recovery database after assessing data written since the release. Database restore is a disaster-recovery action, not the default application rollback mechanism.

## Staging

Staging must be isolated from production. At minimum use:

- a separate staging domain and Caddy certificate,
- a separate PostgreSQL instance/volume and credentials,
- a separate Valkey instance/volume and therefore separate queues,
- a separate R2 bucket or strictly separate staging prefix and credentials,
- Meta test credentials/numbers rather than production sending credentials,
- a distinct Sentry environment/project where practical.

Prefer a separate VPS. If both environments temporarily share a host, use distinct Compose project names, env files, volumes, ports, and buckets. Production and staging must never point at the same `DATABASE_URL` or `REDIS_URL`.

## No automatic deployment from CI

CI builds images, validates Caddy/Prometheus/Compose configuration, and runs health smoke checks. It intentionally has no production credentials and performs no deployment. Promotion remains an explicit operator action after review.
