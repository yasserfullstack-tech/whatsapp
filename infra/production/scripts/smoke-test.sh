#!/bin/sh
set -eu

base_url=${1:-${BASE_URL:-}}
[ -n "$base_url" ] || { echo "Usage: smoke-test.sh https://app.example.com" >&2; exit 1; }
base_url=${base_url%/}

health=$(curl --fail --silent --show-error "$base_url/health")
ready=$(curl --fail --silent --show-error "$base_url/ready")
printf '%s' "$health" | grep -q '"ok":true'
printf '%s' "$ready" | grep -q '"ok":true'

curl --fail --silent --show-error --output /dev/null "$base_url/"

case "$base_url" in
  https://*)
    curl --fail --silent --show-error --head "$base_url/" | tr -d '\r' \
      | grep -qi '^strict-transport-security:'
    ;;
esac

metrics_status=$(curl --silent --output /dev/null --write-out '%{http_code}' "$base_url/metrics")
[ "$metrics_status" = "404" ] || {
  echo "Expected public /metrics to be hidden with 404, got $metrics_status" >&2
  exit 1
}

echo "Deployment smoke test passed for $base_url"
