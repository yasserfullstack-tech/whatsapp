#!/bin/sh
set -eu

mode=${1:-}
release_manifest=${2:-}
output_dir=${3:-load-results/representative-evidence}

usage() {
  echo "Usage: collect-representative-load-evidence.sh <full|errors|chaos|soak|recovery|webhook-status|certify> <release-manifest> [output-dir]" >&2
}

case "$mode" in
  full|errors|chaos|soak|recovery|webhook-status|certify) ;;
  *) usage; exit 2 ;;
esac

[ -f "$release_manifest" ] || { echo "Release manifest not found: $release_manifest" >&2; exit 1; }

script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd)
repo_root=$(CDPATH= cd "$script_dir/../../.." && pwd)
results_dir="$repo_root/load-results"
mkdir -p "$output_dir"

read_manifest() {
  key=$1
  awk -v key="$key" 'index($0, key "=") == 1 { sub(/^[^=]*=/, ""); sub(/\r$/, ""); print; exit }' "$release_manifest"
}

require_env() {
  key=$1
  eval "value=\${$key:-}"
  [ -n "$value" ] || { echo "$key is required for representative evidence" >&2; exit 1; }
}

is_sha256_image() {
  value=$1
  printf '%s\n' "$value" | grep -Eq '@sha256:[0-9a-fA-F]{64}$'
}

release_sha=$(read_manifest RELEASE_SHA)
[ "${#release_sha}" -eq 40 ] || { echo "RELEASE_SHA must be a 40-character Git SHA" >&2; exit 1; }
printf '%s\n' "$release_sha" | grep -Eq '^[0-9a-fA-F]{40}$' || { echo "RELEASE_SHA must be hexadecimal" >&2; exit 1; }

code_sha=${BENCHMARK_CODE_SHA:-$(git -C "$repo_root" rev-parse HEAD)}
[ "$release_sha" = "$code_sha" ] || {
  echo "Release manifest SHA ($release_sha) does not match benchmark code SHA ($code_sha)" >&2
  exit 1
}

for key in WEB_IMAGE API_IMAGE WORKER_IMAGE MIGRATOR_IMAGE
do
  value=$(read_manifest "$key")
  [ -n "$value" ] || { echo "$key is missing from release manifest" >&2; exit 1; }
  is_sha256_image "$value" || { echo "$key must be pinned by @sha256 digest" >&2; exit 1; }
done

require_env REPRESENTATIVE_ENVIRONMENT
require_env REPRESENTATIVE_WORKER_COUNT
require_env REPRESENTATIVE_WORKER_CONCURRENCY
require_env REPRESENTATIVE_STORAGE_PROFILE

case "$REPRESENTATIVE_ENVIRONMENT" in
  staging|production-like) ;;
  *) echo "REPRESENTATIVE_ENVIRONMENT must be staging or production-like" >&2; exit 1 ;;
esac

case "$REPRESENTATIVE_WORKER_COUNT" in
  *[!0-9]*|'') echo "REPRESENTATIVE_WORKER_COUNT must be a positive integer" >&2; exit 1 ;;
esac
case "$REPRESENTATIVE_WORKER_CONCURRENCY" in
  *[!0-9]*|'') echo "REPRESENTATIVE_WORKER_CONCURRENCY must be a positive integer" >&2; exit 1 ;;
esac
[ "$REPRESENTATIVE_WORKER_COUNT" -gt 0 ] || { echo "REPRESENTATIVE_WORKER_COUNT must be > 0" >&2; exit 1; }
[ "$REPRESENTATIVE_WORKER_CONCURRENCY" -gt 0 ] || { echo "REPRESENTATIVE_WORKER_CONCURRENCY must be > 0" >&2; exit 1; }

benchmark_outcome=${BENCHMARK_OUTCOME:-unknown}
capacity_claim=${CAPACITY_CLAIM:-none}
case "$capacity_claim" in
  none|100k|500k) ;;
  *) echo "CAPACITY_CLAIM must be none, 100k, or 500k" >&2; exit 1 ;;
esac

find_report() {
  pattern=$1
  find "$results_dir" -maxdepth 1 -type f -name "$pattern" -print 2>/dev/null | sort | tail -n 1
}

require_report() {
  label=$1
  pattern=$2
  path=$(find_report "$pattern")
  if [ -z "$path" ]; then
    missing_reports="${missing_reports}${missing_reports:+, }$label"
    return
  fi
  present_reports="${present_reports}${present_reports:+
}$label|${path#$repo_root/}"
}

missing_reports=
present_reports=

case "$mode" in
  full)
    require_report "full stress suite" "*-stress-suite-full.json"
    require_report "webhook status flood" "*-webhook-status-*.json"
    ;;
  errors)
    require_report "error stress suite" "*-stress-suite-errors.json"
    require_report "429 recovery" "*-recovery-429.json"
    require_report "500 recovery" "*-recovery-500.json"
    require_report "mixed recovery" "*-recovery-mixed.json"
    ;;
  chaos)
    require_report "Valkey restart chaos" "*-chaos-redis-restart.json"
    require_report "worker restart chaos" "*-chaos-worker-restart.json"
    require_report "Postgres pressure chaos" "*-chaos-postgres-pressure.json"
    require_report "multi-worker chaos" "*-chaos-multi-worker.json"
    ;;
  soak)
    require_report "soak" "*-soak-*.json"
    ;;
  recovery)
    require_report "429 recovery" "*-recovery-429.json"
    require_report "500 recovery" "*-recovery-500.json"
    require_report "mixed recovery" "*-recovery-mixed.json"
    ;;
  webhook-status)
    require_report "webhook flood" "*-webhook-flood-*.json"
    require_report "webhook status flood" "*-webhook-status-*.json"
    ;;
  certify)
    require_report "full stress suite" "*-stress-suite-full.json"
    require_report "429 recovery" "*-recovery-429.json"
    require_report "500 recovery" "*-recovery-500.json"
    require_report "mixed recovery" "*-recovery-mixed.json"
    require_report "Valkey restart chaos" "*-chaos-redis-restart.json"
    require_report "worker restart chaos" "*-chaos-worker-restart.json"
    require_report "Postgres pressure chaos" "*-chaos-postgres-pressure.json"
    require_report "multi-worker chaos" "*-chaos-multi-worker.json"
    require_report "soak" "*-soak-*.json"
    require_report "webhook status flood" "*-webhook-status-*.json"
    ;;
esac

claim_eligible=yes
claim_reason="Representative evidence bundle is complete for the selected mode."
if [ "$benchmark_outcome" != "success" ]; then
  claim_eligible=no
  claim_reason="Benchmark command did not complete successfully."
elif [ -n "$missing_reports" ]; then
  claim_eligible=no
  claim_reason="Required benchmark reports are missing: $missing_reports."
elif [ "$capacity_claim" = "500k" ] && [ "$mode" != "certify" ]; then
  claim_eligible=no
  claim_reason="A 500k claim requires certify mode (full stress, soak, chaos, recovery, and webhook-status evidence)."
elif [ "$capacity_claim" = "100k" ] && [ "$mode" != "full" ] && [ "$mode" != "certify" ]; then
  claim_eligible=no
  claim_reason="A 100k claim requires full or certify mode."
fi

generated_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
run_url=${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-unknown}/actions/runs/${GITHUB_RUN_ID:-unknown}
kernel=$(uname -srmo 2>/dev/null || uname -a)
cpu_count=$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo unknown)
cpu_model=$(awk -F: '/model name/ { sub(/^[ \t]+/, "", $2); print $2; exit }' /proc/cpuinfo 2>/dev/null || true)
[ -n "$cpu_model" ] || cpu_model=unknown
memory_kb=$(awk '/MemTotal:/ { print $2; exit }' /proc/meminfo 2>/dev/null || true)
[ -n "$memory_kb" ] || memory_kb=unknown
disk_summary=$(df -PT "$repo_root" 2>/dev/null | awk 'NR==2 {print $2 " filesystem, " $3 " KiB total, " $5 " KiB available"}' || true)
[ -n "$disk_summary" ] || disk_summary=unknown
load_compose_sha=$(sha256sum "$repo_root/docker-compose.load.yml" 2>/dev/null | awk '{print $1}' || echo unavailable)
chaos_compose_sha=$(sha256sum "$repo_root/docker-compose.load-chaos.yml" 2>/dev/null | awk '{print $1}' || echo unavailable)
thresholds_sha=$(sha256sum "$repo_root/apps/load-test/src/thresholds.ts" 2>/dev/null | awk '{print $1}' || echo unavailable)

postgres_version=unavailable
postgres_max_connections=unavailable
postgres_shared_buffers=unavailable
postgres_work_mem=unavailable
postgres_effective_cache_size=unavailable
postgres_image=unavailable
if docker inspect whatsapp-load-postgres >/dev/null 2>&1; then
  postgres_version=$(docker exec whatsapp-load-postgres psql -U whatsapp -d whatsapp_load -Atqc 'SHOW server_version' 2>/dev/null || echo unavailable)
  postgres_max_connections=$(docker exec whatsapp-load-postgres psql -U whatsapp -d whatsapp_load -Atqc 'SHOW max_connections' 2>/dev/null || echo unavailable)
  postgres_shared_buffers=$(docker exec whatsapp-load-postgres psql -U whatsapp -d whatsapp_load -Atqc 'SHOW shared_buffers' 2>/dev/null || echo unavailable)
  postgres_work_mem=$(docker exec whatsapp-load-postgres psql -U whatsapp -d whatsapp_load -Atqc 'SHOW work_mem' 2>/dev/null || echo unavailable)
  postgres_effective_cache_size=$(docker exec whatsapp-load-postgres psql -U whatsapp -d whatsapp_load -Atqc 'SHOW effective_cache_size' 2>/dev/null || echo unavailable)
  postgres_image=$(docker inspect --format '{{.Config.Image}} | image-id={{.Image}}' whatsapp-load-postgres 2>/dev/null || echo unavailable)
fi

valkey_version=unavailable
valkey_maxmemory=unavailable
valkey_policy=unavailable
valkey_aof=unavailable
valkey_rdb=unavailable
valkey_image=unavailable
if docker inspect whatsapp-load-valkey >/dev/null 2>&1; then
  valkey_version=$(docker exec whatsapp-load-valkey valkey-cli --raw INFO server 2>/dev/null | awk -F: '/^redis_version:/ {gsub(/\r/, "", $2); print $2; exit}' || true)
  [ -n "$valkey_version" ] || valkey_version=unavailable
  valkey_maxmemory=$(docker exec whatsapp-load-valkey valkey-cli --raw CONFIG GET maxmemory 2>/dev/null | tail -n 1 || echo unavailable)
  valkey_policy=$(docker exec whatsapp-load-valkey valkey-cli --raw CONFIG GET maxmemory-policy 2>/dev/null | tail -n 1 || echo unavailable)
  valkey_aof=$(docker exec whatsapp-load-valkey valkey-cli --raw CONFIG GET appendonly 2>/dev/null | tail -n 1 || echo unavailable)
  valkey_rdb=$(docker exec whatsapp-load-valkey valkey-cli --raw CONFIG GET save 2>/dev/null | tail -n 1 || echo unavailable)
  valkey_image=$(docker inspect --format '{{.Config.Image}} | image-id={{.Image}}' whatsapp-load-valkey 2>/dev/null || echo unavailable)
fi

checksums_file="$output_dir/report-sha256.txt"
: > "$checksums_file"
if command -v sha256sum >/dev/null 2>&1; then
  find "$results_dir" -maxdepth 1 -type f \( -name '*.json' -o -name '*.md' \) -print 2>/dev/null \
    | sort \
    | while IFS= read -r report; do
        sha256sum "$report"
      done > "$checksums_file"
fi

evidence_file="$output_dir/representative-load-evidence.md"
json_file="$output_dir/representative-load-evidence.json"

web_image=$(read_manifest WEB_IMAGE)
api_image=$(read_manifest API_IMAGE)
worker_image=$(read_manifest WORKER_IMAGE)
migrator_image=$(read_manifest MIGRATOR_IMAGE)

cat > "$evidence_file" <<EOF
# Representative load validation evidence

- Generated (UTC): $generated_at
- Environment class: $REPRESENTATIVE_ENVIRONMENT
- Benchmark mode: $mode
- Benchmark outcome: $benchmark_outcome
- Requested application-side capacity claim: $capacity_claim
- Claim evidence gate: $( [ "$claim_eligible" = yes ] && echo PASS || echo FAIL )
- Claim evidence rationale: $claim_reason
- Source / release SHA: $release_sha
- Workflow run: $run_url

## Immutable release images

- WEB_IMAGE: $web_image
- API_IMAGE: $api_image
- WORKER_IMAGE: $worker_image
- MIGRATOR_IMAGE: $migrator_image

## Representative machine

- Kernel / architecture: $kernel
- CPU model: $cpu_model
- Logical CPUs: $cpu_count
- Memory: $memory_kb KiB
- Benchmark filesystem: $disk_summary
- Storage profile / IOPS class: $REPRESENTATIVE_STORAGE_PROFILE

## Evidence-definition integrity

- docker-compose.load.yml SHA-256: $load_compose_sha
- docker-compose.load-chaos.yml SHA-256: $chaos_compose_sha
- apps/load-test/src/thresholds.ts SHA-256: $thresholds_sha

## PostgreSQL

- Runtime image: $postgres_image
- Version: $postgres_version
- max_connections: $postgres_max_connections
- shared_buffers: $postgres_shared_buffers
- work_mem: $postgres_work_mem
- effective_cache_size: $postgres_effective_cache_size

## Valkey

- Runtime image: $valkey_image
- Version: $valkey_version
- maxmemory: $valkey_maxmemory
- maxmemory-policy: $valkey_policy
- appendonly: $valkey_aof
- save: $valkey_rdb
- Chaos persistence topology: docker-compose.load-chaos.yml uses AOF with appendfsync=always.

## Worker topology

- Worker processes represented: $REPRESENTATIVE_WORKER_COUNT
- Worker concurrency per process: $REPRESENTATIVE_WORKER_CONCURRENCY
- Aggregate configured worker concurrency: $((REPRESENTATIVE_WORKER_COUNT * REPRESENTATIVE_WORKER_CONCURRENCY))
- Load-test send target: local fake Meta only; this evidence does not claim Meta/provider delivery throughput.

## Required report classes

EOF

if [ -n "$present_reports" ]; then
  printf '%s\n' "$present_reports" | while IFS='|' read -r label path; do
    printf -- '- [x] %s: `%s`\n' "$label" "$path"
  done >> "$evidence_file"
fi
if [ -n "$missing_reports" ]; then
  printf -- '- [ ] Missing: %s\n' "$missing_reports" >> "$evidence_file"
fi

cat >> "$evidence_file" <<EOF

## Evidence integrity

Report checksums are in \`report-sha256.txt\`. The source SHA must match the immutable release manifest before this collector runs. Release image references are required to be pinned by SHA-256 digest.

## Capacity-claim boundary

This bundle can support only application-side capacity statements scoped to the recorded machine, database, Valkey, worker topology, thresholds, and fake-provider conditions. It does not establish WhatsApp/Meta end-to-end delivery throughput. A 500k application-side claim requires \`certify\` mode with full stress, soak, chaos, recovery, and webhook-status evidence and a successful benchmark outcome.
EOF

escape_json() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g'
}

cat > "$json_file" <<EOF
{
  "generatedAt": "$(escape_json "$generated_at")",
  "environment": "$(escape_json "$REPRESENTATIVE_ENVIRONMENT")",
  "mode": "$(escape_json "$mode")",
  "benchmarkOutcome": "$(escape_json "$benchmark_outcome")",
  "capacityClaim": "$(escape_json "$capacity_claim")",
  "claimEvidencePassed": $( [ "$claim_eligible" = yes ] && echo true || echo false ),
  "claimEvidenceRationale": "$(escape_json "$claim_reason")",
  "releaseSha": "$(escape_json "$release_sha")",
  "workflowRun": "$(escape_json "$run_url")",
  "images": {
    "web": "$(escape_json "$web_image")",
    "api": "$(escape_json "$api_image")",
    "worker": "$(escape_json "$worker_image")",
    "migrator": "$(escape_json "$migrator_image")"
  },
  "machine": {
    "kernel": "$(escape_json "$kernel")",
    "cpuModel": "$(escape_json "$cpu_model")",
    "logicalCpus": "$(escape_json "$cpu_count")",
    "memoryKiB": "$(escape_json "$memory_kb")",
    "filesystem": "$(escape_json "$disk_summary")",
    "storageProfile": "$(escape_json "$REPRESENTATIVE_STORAGE_PROFILE")"
  },
  "definitions": {
    "loadComposeSha256": "$(escape_json "$load_compose_sha")",
    "chaosComposeSha256": "$(escape_json "$chaos_compose_sha")",
    "thresholdsSha256": "$(escape_json "$thresholds_sha")"
  },
  "postgres": {
    "runtimeImage": "$(escape_json "$postgres_image")",
    "version": "$(escape_json "$postgres_version")",
    "maxConnections": "$(escape_json "$postgres_max_connections")",
    "sharedBuffers": "$(escape_json "$postgres_shared_buffers")",
    "workMem": "$(escape_json "$postgres_work_mem")",
    "effectiveCacheSize": "$(escape_json "$postgres_effective_cache_size")"
  },
  "valkey": {
    "runtimeImage": "$(escape_json "$valkey_image")",
    "version": "$(escape_json "$valkey_version")",
    "maxmemory": "$(escape_json "$valkey_maxmemory")",
    "maxmemoryPolicy": "$(escape_json "$valkey_policy")",
    "appendonly": "$(escape_json "$valkey_aof")",
    "save": "$(escape_json "$valkey_rdb")"
  },
  "worker": {
    "processes": $REPRESENTATIVE_WORKER_COUNT,
    "concurrencyPerProcess": $REPRESENTATIVE_WORKER_CONCURRENCY,
    "aggregateConcurrency": $((REPRESENTATIVE_WORKER_COUNT * REPRESENTATIVE_WORKER_CONCURRENCY))
  },
  "missingReports": "$(escape_json "$missing_reports")"
}
EOF

echo "Wrote representative load evidence to $evidence_file and $json_file"

if [ "$claim_eligible" != yes ]; then
  exit 1
fi
