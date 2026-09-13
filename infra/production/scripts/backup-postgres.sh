#!/bin/sh
set -eu

COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.production.yml}
ENV_FILE=${ENV_FILE:-.env.production}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/whatsapp/postgres}
LOCAL_RETENTION_DAYS=${LOCAL_RETENTION_DAYS:-14}
OFFSITE_RETENTION_DAYS=${OFFSITE_RETENTION_DAYS:-35}
VERIFY_SCRIPT=${VERIFY_SCRIPT:-infra/production/scripts/verify-postgres-backup.sh}

: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT is required}"
: "${BACKUP_AGE_IDENTITY_FILE:?BACKUP_AGE_IDENTITY_FILE is required}"
: "${BACKUP_RCLONE_REMOTE:?BACKUP_RCLONE_REMOTE is required, e.g. encrypted-backups:whatsapp/postgres}"

for command in docker age rclone sha256sum; do
  command -v "$command" >/dev/null 2>&1 || { echo "Missing required command: $command" >&2; exit 1; }
done

[ -f "$ENV_FILE" ] || { echo "Missing deployment env file: $ENV_FILE" >&2; exit 1; }
[ -x "$VERIFY_SCRIPT" ] || { echo "Restore verification script is not executable: $VERIFY_SCRIPT" >&2; exit 1; }

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup="$BACKUP_DIR/postgres-${timestamp}.dump.age"
partial="${backup}.partial"
checksum="${backup}.sha256"

cleanup() {
  rm -f "$partial"
}
trap cleanup EXIT INT TERM

echo "Creating encrypted PostgreSQL backup: $backup"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres sh -c \
  'exec pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom --compress=6 --no-owner --no-privileges' \
  | age -r "$BACKUP_AGE_RECIPIENT" -o "$partial"

mv "$partial" "$backup"
chmod 600 "$backup"
sha256sum "$backup" > "$checksum"
chmod 600 "$checksum"

echo "Verifying backup by restoring it into an isolated temporary PostgreSQL container"
BACKUP_AGE_IDENTITY_FILE="$BACKUP_AGE_IDENTITY_FILE" "$VERIFY_SCRIPT" "$backup"

echo "Copying verified backup off-server"
rclone copyto "$backup" "${BACKUP_RCLONE_REMOTE}/$(basename "$backup")" --checksum
rclone copyto "$checksum" "${BACKUP_RCLONE_REMOTE}/$(basename "$checksum")" --checksum

find "$BACKUP_DIR" -type f -name 'postgres-*.dump.age' -mtime "+$LOCAL_RETENTION_DAYS" -delete
find "$BACKUP_DIR" -type f -name 'postgres-*.dump.age.sha256' -mtime "+$LOCAL_RETENTION_DAYS" -delete

# The remote must be dedicated to these database backups. Restrict deletion by filename pattern.
rclone delete "$BACKUP_RCLONE_REMOTE" \
  --min-age "${OFFSITE_RETENTION_DAYS}d" \
  --include 'postgres-*.dump.age' \
  --include 'postgres-*.dump.age.sha256' \
  --exclude '*'

echo "Backup completed only after restore verification and off-server copy: $backup"
