#!/bin/sh
set -eu

env_file=${1:-}
[ -n "$env_file" ] || { echo "Usage: check-immutable-images.sh <env-file>" >&2; exit 1; }
[ -f "$env_file" ] || { echo "Environment file not found: $env_file" >&2; exit 1; }

read_env() {
  key=$1
  awk -v key="$key" 'index($0, key "=") == 1 { sub(/^[^=]*=/, ""); sub(/\r$/, ""); print; exit }' "$env_file"
}

zero_digest=0000000000000000000000000000000000000000000000000000000000000000

for key in WEB_IMAGE API_IMAGE WORKER_IMAGE MIGRATOR_IMAGE; do
  ref=$(read_env "$key")
  [ -n "$ref" ] || { echo "$key is missing" >&2; exit 1; }

  case "$ref" in
    *@sha256:*) digest=${ref##*@sha256:} ;;
    *) echo "$key must use an immutable @sha256: digest, not a mutable tag" >&2; exit 1 ;;
  esac

  [ "${#digest}" -eq 64 ] || { echo "$key has an invalid sha256 digest length" >&2; exit 1; }
  case "$digest" in
    *[!0-9a-fA-F]*) echo "$key has a non-hex sha256 digest" >&2; exit 1 ;;
  esac
  [ "$digest" != "$zero_digest" ] || { echo "$key still contains the example zero digest" >&2; exit 1; }
done

echo "Immutable release image check passed for $env_file"
