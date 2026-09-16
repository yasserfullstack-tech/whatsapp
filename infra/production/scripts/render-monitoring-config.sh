#!/bin/sh
set -eu

ENV_FILE=${1:-${ENV_FILE:-.env.production}}
OUTPUT_DIR=${MONITORING_RUNTIME_DIR:-.runtime/monitoring}

[ -f "$ENV_FILE" ] || { echo "Missing environment file: $ENV_FILE" >&2; exit 1; }

APP_DOMAIN=$(sed -n 's/^APP_DOMAIN=//p' "$ENV_FILE" | tail -n 1)
APP_DOMAIN=${APP_DOMAIN#\"}
APP_DOMAIN=${APP_DOMAIN%\"}
APP_DOMAIN=${APP_DOMAIN#\'}
APP_DOMAIN=${APP_DOMAIN%\'}

[ -n "$APP_DOMAIN" ] || { echo "APP_DOMAIN is required in $ENV_FILE" >&2; exit 1; }
printf '%s' "$APP_DOMAIN" | grep -Eq '^[A-Za-z0-9.-]+$' || {
  echo "APP_DOMAIN contains unsupported characters" >&2
  exit 1
}

mkdir -p "$OUTPUT_DIR"
cat > "$OUTPUT_DIR/public-targets.yml" <<EOF
- targets:
    - "https://${APP_DOMAIN}/"
  labels:
    service: public-web
EOF
chmod 644 "$OUTPUT_DIR/public-targets.yml"

echo "Rendered monitoring target for https://${APP_DOMAIN}/"
