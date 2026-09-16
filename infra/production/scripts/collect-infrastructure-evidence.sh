#!/bin/sh
set -eu

environment=${1:-}
env_file=${2:-}
base_url=${3:-}
output=${4:-}

[ "$environment" = "staging" ] || [ "$environment" = "production" ] || {
  echo "Usage: collect-infrastructure-evidence.sh <staging|production> <env-file> <base-url> [output.md]" >&2
  exit 1
}
[ -f "$env_file" ] || { echo "Environment file not found: $env_file" >&2; exit 1; }
[ -n "$base_url" ] || { echo "Base URL is required" >&2; exit 1; }

script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd)
repo_root=$(CDPATH= cd "$script_dir/../../.." && pwd)
compose_file="$repo_root/docker-compose.production.yml"

read_env() {
  key=$1
  awk -v key="$key" 'index($0, key "=") == 1 { sub(/^[^=]*=/, ""); sub(/\r$/, ""); print; exit }' "$env_file"
}

require_configured() {
  key=$1
  value=$(read_env "$key")
  [ -n "$value" ] || { echo "$key is not configured" >&2; exit 1; }
  case "$value" in
    *replace-with-*|*example.com*) echo "$key still contains an example placeholder" >&2; exit 1 ;;
  esac
}

actual_environment=$(read_env DEPLOYMENT_ENVIRONMENT)
[ "$actual_environment" = "$environment" ] || {
  echo "DEPLOYMENT_ENVIRONMENT is '$actual_environment', expected '$environment'" >&2
  exit 1
}

release_sha=$(read_env RELEASE_SHA)
[ "${#release_sha}" -eq 40 ] || { echo "RELEASE_SHA must be a 40-character Git SHA" >&2; exit 1; }
case "$release_sha" in
  *[!0-9a-fA-F]*) echo "RELEASE_SHA must be hexadecimal" >&2; exit 1 ;;
esac

for key in \
  APP_DOMAIN \
  POSTGRES_PASSWORD \
  BETTER_AUTH_SECRET \
  RESEND_API_KEY \
  CREDENTIAL_ENCRYPTION_KEY \
  META_APP_ID \
  META_APP_SECRET \
  META_CONFIG_ID \
  META_VERIFY_TOKEN \
  R2_ACCOUNT_ID \
  R2_ACCESS_KEY_ID \
  R2_SECRET_ACCESS_KEY \
  R2_BUCKET \
  SENTRY_DSN \
  GRAFANA_ADMIN_PASSWORD
do
  require_configured "$key"
done

sh "$script_dir/check-immutable-images.sh" "$env_file"
docker compose --env-file "$env_file" -f "$compose_file" config --quiet
sh "$script_dir/smoke-test.sh" "$base_url"

project_name=$(read_env COMPOSE_PROJECT_NAME)
app_domain=$(read_env APP_DOMAIN)
generated_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
[ -n "$output" ] || output="infrastructure-evidence-$environment-$release_sha.md"

services=$(docker compose --env-file "$env_file" -f "$compose_file" ps --format 'table {{.Service}}\t{{.Image}}\t{{.Status}}' 2>/dev/null || true)
[ -n "$services" ] || services="Runtime service table unavailable; capture docker compose ps output manually."

umask 077
cat > "$output" <<EOF
# Infrastructure evidence — $environment

- Generated (UTC): $generated_at
- Release SHA: $release_sha
- Compose project: $project_name
- Application domain: $app_domain
- Base URL tested: $base_url

## Immutable release images

- WEB_IMAGE: $(read_env WEB_IMAGE)
- API_IMAGE: $(read_env API_IMAGE)
- WORKER_IMAGE: $(read_env WORKER_IMAGE)
- MIGRATOR_IMAGE: $(read_env MIGRATOR_IMAGE)

## Automated checks

- [x] Environment identity matches $environment.
- [x] Required provider/secret configuration is present; values are intentionally redacted.
- [x] All release images are pinned by non-placeholder SHA-256 digest.
- [x] Docker Compose configuration renders successfully.
- [x] Public HTTPS smoke test passed for $base_url, including /health, /ready, web root, HSTS, and hidden public /metrics.

## Runtime services

$services

## Operator evidence to attach to issue #54 / the PR

- [ ] DNS record/provider evidence for $app_domain.
- [ ] Host firewall evidence showing only intended public ingress (normally 80/443 plus the controlled operator access path).
- [ ] Host/provider identity proving staging and production are isolated, or separate Compose-project evidence if temporarily co-located.
- [ ] Output from verify-environment-isolation.sh using the real staging and production env files.
- [ ] R2 bucket/credential evidence, with secrets redacted.
- [ ] Meta app/config/number evidence, with secrets/tokens redacted.
- [ ] Email provider and Sentry project/environment evidence.
- [ ] Rollback drill record showing a previous immutable release was restored and smoke-tested in staging before production sign-off.
EOF

echo "Wrote redacted infrastructure evidence to $output"
