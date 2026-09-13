#!/bin/sh
set -eu

backup=${1:?Usage: verify-postgres-backup.sh /path/to/postgres-*.dump.age}
: "${BACKUP_AGE_IDENTITY_FILE:?BACKUP_AGE_IDENTITY_FILE is required}"

[ -f "$backup" ] || { echo "Backup not found: $backup" >&2; exit 1; }
[ -f "$BACKUP_AGE_IDENTITY_FILE" ] || { echo "Age identity file not found" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "docker is required" >&2; exit 1; }
command -v age >/dev/null 2>&1 || { echo "age is required" >&2; exit 1; }

name="wa-backup-verify-$(date +%s)-$$"
password="verify-only-$$-$(date +%s)"

cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker run -d --name "$name" \
  -e POSTGRES_DB=verify \
  -e POSTGRES_USER=verify \
  -e POSTGRES_PASSWORD="$password" \
  postgres:17-alpine >/dev/null

i=0
until docker exec "$name" pg_isready -U verify -d verify >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -lt 30 ] || { echo "Temporary PostgreSQL did not become ready" >&2; exit 1; }
  sleep 1
done

age -d -i "$BACKUP_AGE_IDENTITY_FILE" "$backup" \
  | docker exec -i "$name" pg_restore -U verify -d verify --exit-on-error --no-owner --no-privileges

table_count=$(docker exec "$name" psql -U verify -d verify -Atqc \
  "select count(*) from pg_tables where schemaname = 'public';")

[ "$table_count" -gt 0 ] || { echo "Restore verification failed: no public tables were restored" >&2; exit 1; }
docker exec "$name" psql -U verify -d verify -Atqc 'select 1' | grep -qx '1'

echo "Restore verification succeeded (${table_count} public tables)"
