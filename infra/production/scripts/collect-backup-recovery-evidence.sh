#!/bin/sh
set -eu

BACKUP_ENV_FILE=${BACKUP_ENV_FILE:-/etc/whatsapp/backup.env}
OUTPUT=${1:-backup-recovery-evidence-$(date -u +%Y%m%dT%H%M%SZ).md}

if [ -f "$BACKUP_ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$BACKUP_ENV_FILE"
  set +a
fi

BACKUP_METRICS_DIR=${BACKUP_METRICS_DIR:-/var/lib/whatsapp/node-exporter}
MAX_BACKUP_AGE_SECONDS=${MAX_BACKUP_AGE_SECONDS:-93600}
: "${BACKUP_RCLONE_REMOTE:?BACKUP_RCLONE_REMOTE must be configured in the environment or backup env file}"

for command in systemctl rclone awk date; do
  command -v "$command" >/dev/null 2>&1 || { echo "Missing required command: $command" >&2; exit 1; }
done

enabled=$(systemctl is-enabled whatsapp-backup.timer 2>/dev/null || true)
active=$(systemctl is-active whatsapp-backup.timer 2>/dev/null || true)
next_run=$(systemctl show whatsapp-backup.timer -p NextElapseUSecRealtime --value 2>/dev/null || true)
service_result=$(systemctl show whatsapp-backup.service -p Result --value 2>/dev/null || true)

success_metric="$BACKUP_METRICS_DIR/whatsapp-backup-success.prom"
last_success_epoch=""
if [ -f "$success_metric" ]; then
  last_success_epoch=$(awk '$1 == "whatsapp_backup_last_success_timestamp_seconds" { print $2 }' "$success_metric" | tail -n 1)
fi

now=$(date -u +%s)
backup_age_seconds="unknown"
last_success_utc="unknown"
if [ -n "$last_success_epoch" ]; then
  backup_age_seconds=$((now - last_success_epoch))
  last_success_utc=$(date -u -d "@$last_success_epoch" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || printf '%s' "$last_success_epoch")
fi

latest=$(rclone lsf "$BACKUP_RCLONE_REMOTE" --files-only --include 'postgres-*.dump.age' | LC_ALL=C sort | tail -n 1)
checksum_present="no"
if [ -n "$latest" ] && rclone lsf "$BACKUP_RCLONE_REMOTE" --files-only --include "${latest}.sha256" | grep -Fx "${latest}.sha256" >/dev/null 2>&1; then
  checksum_present="yes"
fi

status="pass"
[ "$enabled" = "enabled" ] || status="fail"
[ "$active" = "active" ] || status="fail"
[ -n "$last_success_epoch" ] || status="fail"
if [ "$backup_age_seconds" != "unknown" ] && [ "$backup_age_seconds" -gt "$MAX_BACKUP_AGE_SECONDS" ]; then
  status="fail"
fi
[ -n "$latest" ] || status="fail"
[ "$checksum_present" = "yes" ] || status="fail"

cat > "$OUTPUT" <<EOF
# Backup/recovery readiness evidence

- Collected at (UTC): $(date -u +%Y-%m-%dT%H:%M:%SZ)
- Overall readiness check: ${status}
- Backup timer enabled: ${enabled:-unknown}
- Backup timer active: ${active:-unknown}
- Next scheduled run: ${next_run:-unknown}
- Last backup service result: ${service_result:-unknown}
- Last verified/off-server backup success: ${last_success_utc}
- Backup age: ${backup_age_seconds} seconds
- Maximum accepted evidence age: ${MAX_BACKUP_AGE_SECONDS} seconds
- Latest off-server backup object: ${latest:-none}
- Matching off-server checksum object present: ${checksum_present}

The off-server remote name, credentials, age recipient/private identity, deployment secrets, database credentials, and customer data are intentionally omitted. Pair this snapshot with a successful `recovery-drill.sh` evidence record for PR-010.
EOF

chmod 600 "$OUTPUT"
echo "Redacted backup/recovery evidence written to $OUTPUT"
[ "$status" = "pass" ]
