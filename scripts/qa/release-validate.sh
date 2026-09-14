#!/usr/bin/env bash
set -euo pipefail

cleanup() {
  bun run load:infra:down >/dev/null 2>&1 || true
  docker compose -f docker-compose.load-chaos.yml down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

bun scripts/qa/assert-test-env.ts
bun install --frozen-lockfile
bun run qa:coverage

bun run db:generate -- --name=release-drift
if [ -n "$(git status --porcelain -- packages/db/drizzle)" ]; then
  echo "Schema and committed Drizzle migrations are out of sync." >&2
  git status --short -- packages/db/drizzle >&2
  exit 1
fi

bun run db:migrate
bun run db:verify
bun run test
bun run test:webhook-critical
bun run typecheck
bun run build

bunx playwright install --with-deps chromium
bun run test:e2e
bun run test:security
bun audit --audit-level=high

bun run test:load-smoke
bun run test:resilience-smoke

echo "Portable release validation passed. Gitleaks and CodeQL are enforced by GitHub Actions because they require repository-history/security-event context."
