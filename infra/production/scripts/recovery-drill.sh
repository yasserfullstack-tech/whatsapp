#!/bin/sh
set -eu

APP_DIR=${APP_DIR:-/srv/whatsapp}
VERIFY_SCRIPT=${VERIFY_SCRIPT:-$APP_DIR/infra/production/scripts/verify-postgres-backup.sh}
RECOVERY_EVIDENCE_DIR=${RECOVERY_EVIDENCE_DIR:-./recovery-evidence}
KEEP_RECOVERY_WORKDIR=${KEEP_RECOVERY_WORKDIR:-0}

: "${BACKUP_RCLONE_REMOTE:?BACKUP_RCLONE_REMOTE is required}"
: "${BACKUP_AGE_IDENTITY_FILE:?BACKUP_AGE_IDENTITY_FILE is required}"

for command in rclone sha256sum awk docker age mktemp date; do
  command -v "$command" >/dev/null 2>&1 || { echo "Missing required command: $command" >&2; exit 1; }
done

[ -f "$BACKUP_AGE_IDENTITY_FILE" ] || { echo "Age identity file not found" >&2; exit 1; }
[ -x "$VERIFY_SCRIPT" ] || { echo "Restore verification script is not executable: $VERIFY_SCRIPT" >&2; exit 1; }

work_dir=${RECOVERY_WORK_DIR:-$(mktemp -d)}
mkdir -p "$work_dir" "$RECOVERY_EVIDENCE_DIR"

cleanup() {
  status=$?
  if [ "$KEEP_RECOVERY_WORKDIR" != "1" ]; then
    rm -rf "$work_dir"
  else
    echo "Recovery work directory preserved at $work_dir"
  fi
  trap - EXIT
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

latest=$(rclone lsf "$BACKUP_RCLONE_REMOTE" --files-only --include 'postgres-*.dump.age' | LC_ALL=C sort | tail -n 1)
[ -n "$latest" ] || { echo "No off-server PostgreSQL backups found" >&2; exit 1; }

checksum_name="${latest}.sha256"
backup="$work_dir/$latest"
checksum="$work_dir/$checksum_name"

echo "Downloading latest verified backup from the configured off-server remote"
rclone copyto "${BACKUP_RCLONE_REMOTE}/${latest}" "$backup"
rclone copyto "${BACKUP_RCLONE_REMOTE}/${checksum_name}" "$checksum"

expected=$(awk 'NR == 1 { print $1 }' "$checksum")
actual=$(sha256sum "$backup" | awk '{ print $1 }')
[ -n "$expected" ] || { echo "Checksum file is empty or invalid" >&2; exit 1; }
[ "$expected" = "$actual" ] || { echo "Off-server backup checksum mismatch" >&2; exit 1; }

echo "Off-server checksum verified"
started=$(date -u +%s)
BACKUP_AGE_IDENTITY_FILE="$BACKUP_AGE_IDENTITY_FILE" "$VERIFY_SCRIPT" "$backup"
finished=$(date -u +%s)
elapsed=$((finished - started))

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
evidence="$RECOVERY_EVIDENCE_DIR/recovery-drill-${timestamp}.md"
cat > "$evidence" <<EOF
# PostgreSQL recovery drill evidence

- Drill timestamp (UTC): ${timestamp}
- Source: configured off-server backup remote
- Backup object: ${latest}
- Off-server checksum verification: passed
- Isolated clean-database restore verification: passed
- Restore verification elapsed time: ${elapsed} seconds

This evidence file intentionally contains no rclone credentials, age identity material, database credentials, customer data, or decrypted dump content. For PR-010 clean-host evidence, run this script on a newly provisioned recovery host and attach this record together with the host-provisioning timestamp and the application smoke-test result.
EOF

chmod 600 "$evidence"
echo "Recovery drill succeeded; redacted evidence written to $evidence"
