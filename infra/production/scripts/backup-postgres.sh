#!/bin/sh
set -eu

COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.production.yml}
ENV_FILE=${ENV_FILE:-.env.production}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/whatsapp/postgres}
BACKUP_METRICS_DIR=${BACKUP_METRICS_DIR:-/var/lib/whatsapp/node-exporter}
LOCAL_RETENTION_DAYS=${LOCAL_RETENTION_DAYS:-14}
OFFSITE_RETENTION_DAYS=${OFFSITE_RETENTION_DAYS:-35}
VERIFY_SCRIPT=${VERIFY_SCRIPT:-infra/production/scripts/verify-postgres-backup.sh}
partial=""

mkdir -p "$BACKUP_METRICS_DIR"
chmod 755 "$BACKUP_METRICS_DIR"

write_metric() {
  name=$1
  value=$2
  target=$3
  temporary="${target}.tmp.$$"
  printf '# TYPE %s gauge\n%s %s\n' "$name" "$name" "$value" > "$temporary"
  chmod 644 "$temporary"
  mv "$temporary" "$target"
}

cleanup() {
  status=$?
  if [ -n "$partial" ]; then rm -f "$partial"; fi
  if [ "$status" -ne 0 ]; then
    write_metric \
      whatsapp_backup_last_failure_timestamp_seconds \
      "$(date -u +%s)" \
      "$BACKUP_METRICS_DIR/whatsapp-backup-failure.prom"
  fi
  trap - EXIT
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT is required}"
: "${BACKUP_AGE_IDENTITY_FILE:?BACKUP_AGE_IDENTITY_FILE is required}"
: "${BACKUP_RCLONE_REMOTE:?BACKUP_RCLONE_REMOTE is required, e.g. encrypted-backups:whatsapp/postgres}"

for command in docker age rclone sha256sum awk; do
  command -v "$command" >/dev/null 2>&1 || { echo "Missing required command: $command" >&2; exit 1; }
done

[ -f "$ENV_FILE" ] || { echo "Missing deployment env file: $ENV_FILE" >&2; exit 1; }
[ -x "$VERIFY_SCRIPT" ] || { echo "Restore verification script is not executable: $VERIFY_SCRIPT" >&2; exit 1; }

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_name="postgres-${timestamp}.dump.age"
backup="$BACKUP_DIR/$backup_name"
partial="${backup}.partial"
checksum_name="${backup_name}.sha256"
checksum="$BACKUP_DIR/$checksum_name"

echo "Creating encrypted PostgreSQL backup: $backup"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres sh -c \
  'exec pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom --compress=6 --no-owner --no-privileges' \
  | age -r "$BACKUP_AGE_RECIPIENT" -o "$partial"

mv "$partial" "$backup"
partial=""
chmod 600 "$backup"
backup_sha256=$(sha256sum "$backup" | awk '{ print $1 }')
printf '%s  %s\n' "$backup_sha256" "$backup_name" > "$checksum"
chmod 600 "$checksum"

echo "Verifying backup by restoring it into an isolated temporary PostgreSQL container"
BACKUP_AGE_IDENTITY_FILE="$BACKUP_AGE_IDENTITY_FILE" "$VERIFY_SCRIPT" "$backup"

echo "Copying verified backup off-server"
rclone copyto "$backup" "${BACKUP_RCLONE_REMOTE}/${backup_name}" --checksum
rclone copyto "$checksum" "${BACKUP_RCLONE_REMOTE}/${checksum_name}" --checksum

# Require both expected objects to be visible remotely before recording success.
rclone lsf "$BACKUP_RCLONE_REMOTE" --files-only --include "$backup_name" | grep -Fx "$backup_name" >/dev/null
rclone lsf "$BACKUP_RCLONE_REMOTE" --files-only --include "$checksum_name" | grep -Fx "$checksum_name" >/dev/null

find "$BACKUP_DIR" -type f -name 'postgres-*.dump.age' -mtime "+$LOCAL_RETENTION_DAYS" -delete
find "$BACKUP_DIR" -type f -name 'postgres-*.dump.age.sha256' -mtime "+$LOCAL_RETENTION_DAYS" -delete

# The remote must be dedicated to these database backups. Restrict deletion by filename pattern.
rclone delete "$BACKUP_RCLONE_REMOTE" \
  --min-age "${OFFSITE_RETENTION_DAYS}d" \
  --include 'postgres-*.dump.age' \
  --include 'postgres-*.dump.age.sha256' \
  --exclude '*'

write_metric \
  whatsapp_backup_last_success_timestamp_seconds \
  "$(date -u +%s)" \
  "$BACKUP_METRICS_DIR/whatsapp-backup-success.prom"

echo "Backup completed only after restore verification and off-server copy: $backup"
