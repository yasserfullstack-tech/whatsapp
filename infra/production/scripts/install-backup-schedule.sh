#!/bin/sh
set -eu

APP_DIR=${APP_DIR:-/srv/whatsapp}
BACKUP_ENV_FILE=${BACKUP_ENV_FILE:-/etc/whatsapp/backup.env}
SYSTEMD_DIR=${SYSTEMD_DIR:-/etc/systemd/system}
RUN_INITIAL_BACKUP=${RUN_INITIAL_BACKUP:-0}

[ "$(id -u)" -eq 0 ] || { echo "Run as root" >&2; exit 1; }
command -v systemctl >/dev/null 2>&1 || { echo "systemctl is required" >&2; exit 1; }

service_source="$APP_DIR/infra/production/systemd/whatsapp-backup.service"
timer_source="$APP_DIR/infra/production/systemd/whatsapp-backup.timer"

[ -f "$service_source" ] || { echo "Missing service unit: $service_source" >&2; exit 1; }
[ -f "$timer_source" ] || { echo "Missing timer unit: $timer_source" >&2; exit 1; }
[ -f "$BACKUP_ENV_FILE" ] || { echo "Missing backup environment file: $BACKUP_ENV_FILE" >&2; exit 1; }

mode=$(stat -c '%a' "$BACKUP_ENV_FILE")
case "$mode" in
  600|400) ;;
  *) echo "Backup environment file must be mode 600 or 400, got $mode" >&2; exit 1 ;;
esac

install -m 0644 "$service_source" "$SYSTEMD_DIR/whatsapp-backup.service"
install -m 0644 "$timer_source" "$SYSTEMD_DIR/whatsapp-backup.timer"
systemctl daemon-reload
systemctl enable --now whatsapp-backup.timer

if [ "$RUN_INITIAL_BACKUP" = "1" ]; then
  systemctl start whatsapp-backup.service
fi

echo "Backup timer enabled:"
systemctl --no-pager list-timers whatsapp-backup.timer
