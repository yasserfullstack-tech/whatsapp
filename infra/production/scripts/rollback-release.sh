#!/bin/sh
set -eu

env_file=${1:-}
release_manifest=${2:-}
base_url=${3:-}
mode=${4:-}

[ -n "$env_file" ] && [ -n "$release_manifest" ] && [ -n "$base_url" ] || {
  echo "Usage: rollback-release.sh <env-file> <previous-release-manifest> <base-url> [--apply]" >&2
  exit 1
}
[ -f "$env_file" ] || { echo "Environment file not found: $env_file" >&2; exit 1; }
[ -f "$release_manifest" ] || { echo "Release manifest not found: $release_manifest" >&2; exit 1; }

script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd)
repo_root=$(CDPATH= cd "$script_dir/../../.." && pwd)
compose_file="$repo_root/docker-compose.production.yml"

sh "$script_dir/check-immutable-images.sh" "$release_manifest"
docker compose \
  --env-file "$env_file" \
  --env-file "$release_manifest" \
  -f "$compose_file" \
  config --quiet

if [ "$mode" != "--apply" ]; then
  echo "Rollback rehearsal preflight passed. No services were changed."
  echo "Re-run with --apply in staging to rehearse a real rollback and smoke test."
  exit 0
fi

echo "Applying previous immutable web/API/worker release. Database migrations are not reversed automatically."
docker compose \
  --env-file "$env_file" \
  --env-file "$release_manifest" \
  -f "$compose_file" \
  pull web api worker

docker compose \
  --env-file "$env_file" \
  --env-file "$release_manifest" \
  -f "$compose_file" \
  up -d --no-build --remove-orphans web api worker

sh "$script_dir/smoke-test.sh" "$base_url"
echo "Rollback apply and smoke test passed for $base_url"
