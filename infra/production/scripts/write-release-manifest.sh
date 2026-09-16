#!/bin/sh
set -eu

env_file=${1:-}
output=${2:-}
[ -n "$env_file" ] || { echo "Usage: write-release-manifest.sh <env-file> [output-file]" >&2; exit 1; }
[ -f "$env_file" ] || { echo "Environment file not found: $env_file" >&2; exit 1; }

script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd)
sh "$script_dir/check-immutable-images.sh" "$env_file"

read_env() {
  key=$1
  awk -v key="$key" 'index($0, key "=") == 1 { sub(/^[^=]*=/, ""); sub(/\r$/, ""); print; exit }' "$env_file"
}

release_sha=$(read_env RELEASE_SHA)
[ -n "$release_sha" ] || { echo "RELEASE_SHA is required" >&2; exit 1; }
[ "${#release_sha}" -eq 40 ] || { echo "RELEASE_SHA must be a 40-character Git SHA" >&2; exit 1; }
case "$release_sha" in
  *[!0-9a-fA-F]*) echo "RELEASE_SHA must be hexadecimal" >&2; exit 1 ;;
esac

if [ -z "$output" ]; then
  output="release-$release_sha.env"
fi

umask 077
cat > "$output" <<EOF
# Safe release manifest: image digests and source SHA only. No credentials.
RELEASE_SHA=$release_sha
WEB_IMAGE=$(read_env WEB_IMAGE)
API_IMAGE=$(read_env API_IMAGE)
WORKER_IMAGE=$(read_env WORKER_IMAGE)
MIGRATOR_IMAGE=$(read_env MIGRATOR_IMAGE)
EOF

echo "Wrote release manifest to $output"
