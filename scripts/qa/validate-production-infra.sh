#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=.env.production.ci
OVERRIDE_FILE=.qa.production.override.yml
COMPOSE=(docker compose --env-file "$ENV_FILE" -f docker-compose.production.yml -f "$OVERRIDE_FILE")

cleanup() {
  if [[ -f "$ENV_FILE" && -f "$OVERRIDE_FILE" ]]; then
    "${COMPOSE[@]}" --profile ops down -v --remove-orphans >/dev/null 2>&1 || true
  fi
  rm -f "$ENV_FILE" "$OVERRIDE_FILE"
}
trap cleanup EXIT

cp .env.production.example "$ENV_FILE"
cat > "$OVERRIDE_FILE" <<'YAML'
networks:
  backend:
    internal: true
YAML

sh -n infra/production/scripts/backup-postgres.sh
sh -n infra/production/scripts/verify-postgres-backup.sh
sh -n infra/production/scripts/smoke-test.sh

"${COMPOSE[@]}" config --quiet

docker run --rm \
  -e APP_DOMAIN=example.test \
  -e CADDY_EMAIL=ops@example.test \
  -e CADDY_MAX_REQUEST_BODY=16MB \
  -v "$PWD/infra/production/Caddyfile:/etc/caddy/Caddyfile:ro" \
  caddy:2.10-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

docker run --rm --entrypoint /bin/promtool \
  -v "$PWD/infra/production/prometheus.yml:/etc/prometheus/prometheus.yml:ro" \
  prom/prometheus:v3.13.3 \
  check config /etc/prometheus/prometheus.yml

docker build -f infra/docker/web.Dockerfile -t whatsapp-web:local .
docker build -f infra/docker/api.Dockerfile -t whatsapp-api:local .
docker build -f infra/docker/worker.Dockerfile -t whatsapp-worker:local .
docker build -f infra/docker/api.Dockerfile --target migrator -t whatsapp-migrator:local .

"${COMPOSE[@]}" up -d --no-build postgres valkey
"${COMPOSE[@]}" --profile ops run --rm migrate
"${COMPOSE[@]}" up -d --no-build web api worker

retry() {
  local name=$1
  shift
  for _attempt in $(seq 1 40); do
    if "$@"; then
      echo "$name is ready"
      return 0
    fi
    sleep 2
  done
  echo "$name did not become ready" >&2
  "${COMPOSE[@]}" ps >&2 || true
  "${COMPOSE[@]}" logs --no-color --tail=200 >&2 || true
  return 1
}

retry web "${COMPOSE[@]}" exec -T web \
  node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

retry api "${COMPOSE[@]}" exec -T api \
  bun -e "fetch('http://127.0.0.1:4000/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

retry worker "${COMPOSE[@]}" exec -T worker \
  bun -e "fetch('http://127.0.0.1:9464/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

"${COMPOSE[@]}" exec -T api \
  bun -e "fetch('http://127.0.0.1:4000/metrics').then(r=>r.text()).then(t=>process.exit(t.includes('whatsapp_http_requests_total')?0:1)).catch(()=>process.exit(1))"

"${COMPOSE[@]}" exec -T worker \
  bun -e "fetch('http://127.0.0.1:9464/metrics').then(r=>r.text()).then(t=>process.exit(t.includes('whatsapp_queue_depth')?0:1)).catch(()=>process.exit(1))"

echo "Production infrastructure validation passed on an internal-only Docker network using disposable local containers and placeholder production configuration."
