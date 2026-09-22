# Staging and production infrastructure verification

This runbook implements the repository-side controls for **PR-009** in `docs/production-readiness-plan.md`. It builds on `docs/deployment.md` and `docker-compose.production.yml`; it does not replace the deployment architecture.

PR-009 is intentionally still an external-evidence task. Do not check it complete only because these scripts and templates exist. The real staging and production environments must be deployed, smoke-tested, isolated, and evidenced in issue #54 / the PR.

## Environment model

Use two independent deployment identities:

- staging: `.env.staging` from `.env.staging.example`, `COMPOSE_PROJECT_NAME=whatsapp-staging`;
- production: `.env.production` from `.env.production.example`, `COMPOSE_PROJECT_NAME=whatsapp-production`.

A separate VPS/host for each environment is preferred. If staging and production are temporarily co-located, the distinct Compose project names are mandatory so Docker networks and named volumes are project-scoped. Do not override names in the Compose file to fixed global names.

Staging and production must not reuse:

- PostgreSQL database/user/password;
- authentication or credential-encryption secrets;
- Meta app/config/verify credentials;
- R2 bucket credentials or bucket name;
- SMTP mail credentials used for real customer mail (Google/Gmail is the current default);
- Grafana administrator password.

The literal `REDIS_URL=redis://valkey:6379` may be the same because `valkey` resolves inside each isolated Compose project/network. What must differ is the underlying Valkey container/volume or host.

## Host and provider prerequisites

For each environment provision and record:

1. A supported Linux host with Docker Engine and Docker Compose v2.
2. DNS for the environment domain pointing only to the intended host.
3. A host firewall exposing the public application only on TCP 80/443 and UDP 443; keep PostgreSQL, Valkey, API/worker metrics, Prometheus, and Grafana off the public interface. Retain only the controlled operator access path required to administer the host.
4. Host-only environment files with mode `0600` and no secrets committed to Git.
5. Environment-specific PostgreSQL and Valkey state.
6. Environment-specific R2 bucket/credentials.
7. Staging/test Meta assets for staging and the approved production Meta configuration for production.
8. SMTP email provider configuration appropriate to the environment. The default examples use Gmail (`smtp.gmail.com`, TLS/465) with an App Password; another SMTP provider can be substituted through environment variables.
9. Sentry DSN/project configuration with `SENTRY_ENVIRONMENT=staging` or `production`.
10. Immutable application/migrator image references pinned by registry SHA-256 digest.

Caddy obtains and renews TLS certificates. A passing HTTPS smoke test therefore validates the public certificate chain from the test host and also verifies HSTS is returned.

## Prepare the host-only environment files

```bash
cp .env.staging.example .env.staging
cp .env.production.example .env.production
chmod 600 .env.staging .env.production
```

Fill every real value on the relevant host. Set `RELEASE_SHA` to the exact 40-character source commit used to build the four images.

Before either deployment, prove that release images are immutable:

```bash
sh infra/production/scripts/check-immutable-images.sh .env.staging
sh infra/production/scripts/check-immutable-images.sh .env.production
```

### Publish an immutable candidate release

The repository does not deploy to staging or production from CI, but it can publish
the exact reviewed images that an operator later promotes. Run the **Release
Images** workflow manually and provide the full 40-character commit SHA to
publish.

The workflow refuses any SHA that is not already in `origin/main`, then builds
and pushes the web, API, worker, and migrator images to GitHub Container
Registry. Each invocation uses a unique run-and-attempt tag so a workflow
rerun cannot silently move the tag selected by an earlier attempt. After the
push, the workflow scans the exact returned registry digests plus the checked-
out dependency set with the same fixable HIGH/CRITICAL blocking policy used by
Production Infra. It emits the release manifest only when that policy passes.
The workflow uploads a safe `release.env` artifact containing only:

- the exact reviewed source SHA;
- `WEB_IMAGE`, `API_IMAGE`, `WORKER_IMAGE`, and `MIGRATOR_IMAGE` as
  immutable `ghcr.io/...@sha256:...` references.

Copy those digest references into the host-only staging environment file and
run `check-immutable-images.sh` again before deployment. Do not use the
workflow's human-readable tag as the deployment identity.

If the GHCR packages are not public, authenticate the deployment host to
`ghcr.io` with a least-privilege credential that can only read packages.
Keep that credential on the host/operator secret store; never commit it or put
it in the safe release manifest.

This publisher creates release artifacts only. It intentionally has no host,
DNS, provider, staging, or production credentials and performs no deployment.

Where an operator can securely access both host-only env files, verify isolation without printing secret values:

```bash
sh infra/production/scripts/verify-environment-isolation.sh \
  .env.staging \
  .env.production
```

Attach the command output to issue #54. If the env files live on separate hosts, copy them temporarily to a secure operator machine or perform an equivalent reviewed comparison; never attach the files themselves.

## Deploy staging first

Use the normal deployment sequence from `docs/deployment.md`, with the staging env file:

```bash
docker compose --env-file .env.staging -f docker-compose.production.yml config --quiet

docker compose --env-file .env.staging -f docker-compose.production.yml up -d postgres valkey
docker compose --env-file .env.staging -f docker-compose.production.yml --profile ops run --rm migrate
docker compose --env-file .env.staging -f docker-compose.production.yml \
  up -d --remove-orphans --scale worker=1 web api worker prometheus grafana caddy
```

Then generate redacted evidence. The evidence collector refuses example placeholders, mutable/zero image digests, missing production-provider configuration, a broken Compose render, or a failed public smoke test:

```bash
sh infra/production/scripts/collect-infrastructure-evidence.sh \
  staging \
  .env.staging \
  https://staging.example.com \
  staging-infrastructure-evidence.md
```

Review the generated file before attaching it. It contains image digests and runtime service state but intentionally does not print secrets.

## Record every release

After a release is ready to promote, store a safe machine-readable manifest containing only the source SHA and image digests:

```bash
mkdir -p releases
sh infra/production/scripts/write-release-manifest.sh \
  .env.staging \
  releases/staging-current.env
```

The manifest contains no credentials, but keep release records with normal operator access controls. Preserve the previous known-good manifest for rollback.

## Rehearse rollback in staging

A rollback rehearsal must restore an actual previous immutable release and pass the smoke test; a config-only dry run is useful preflight but is not sufficient evidence by itself.

First validate without changing services:

```bash
sh infra/production/scripts/rollback-release.sh \
  .env.staging \
  releases/staging-previous.env \
  https://staging.example.com
```

Then perform the staging rollback drill:

```bash
sh infra/production/scripts/rollback-release.sh \
  .env.staging \
  releases/staging-previous.env \
  https://staging.example.com \
  --apply
```

The script changes only the web/API/worker images, does not reverse database migrations, and runs the public smoke test after the rollback. Capture the command output and the previous manifest's release SHA/image digests as rollback evidence.

After the drill, redeploy the intended staging release normally and re-run the smoke/evidence collector.

## Promote to production

Only after staging passes:

1. Confirm the production host/provider prerequisites and firewall.
2. Confirm `.env.production` contains production-only secrets/assets and digest-pinned release images.
3. Back up the production database according to `docs/backups.md` before the release.
4. Deploy using the release flow in `docs/deployment.md`.
5. Run the production evidence collector:

```bash
sh infra/production/scripts/collect-infrastructure-evidence.sh \
  production \
  .env.production \
  https://example.com \
  production-infrastructure-evidence.md
```

6. Write/preserve the production release manifest for the next rollback window.

## Evidence required to close PR-009

Attach redacted evidence to issue #54 / the PR showing all of the following:

- staging smoke test passed for a specific release SHA and image digests;
- production smoke test passed for a specific release SHA and image digests;
- DNS and TLS are correct for both public domains;
- host firewall rules expose only intended ingress;
- staging and production use distinct Compose projects/hosts, PostgreSQL state/credentials, Valkey instances/volumes, R2 credentials/buckets, and Meta assets;
- production email and Sentry configuration is present;
- real environment files are host-only and not committed;
- an actual previous immutable release was restored and smoke-tested in staging as the rollback rehearsal.

Only after that evidence is attached should PR-009's top-level and definition-of-done checkboxes be changed to complete.
