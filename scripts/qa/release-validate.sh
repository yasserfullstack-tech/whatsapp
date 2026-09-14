#!/usr/bin/env bash
set -euo pipefail

cleanup() {
  bun run load:infra:down >/dev/null 2>&1 || true
  docker compose -f docker-compose.load-chaos.yml down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

bash scripts/qa/assert-combined-base.sh
bun scripts/qa/assert-test-env.ts
bun install --frozen-lockfile
bun run qa:coverage
bun run qa:mock-audit

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
bunx playwright test -c playwright.config.ts
bun run test:security
bun audit --audit-level=high

bun run load:stress -- --profile=pr --webhook-events=1000 --webhook-concurrency=50
bun run load:webhook-status -- --recipients=1000 --concurrency=50 --timeout-ms=120000
bun run load:recovery -- --mode=429 --recipients=1000 --fault-after-ms=3000 --timeout-ms=180000
bun run load:recovery -- --mode=500 --recipients=1000 --fault-after-ms=3000 --timeout-ms=180000
bun run load:chaos -- --chaos=redis-restart --scenario=baseline-80 --recipients=1000 --fault-after-ms=3000 --timeout-ms=180000
bun run load:chaos -- --chaos=worker-restart --scenario=baseline-80 --recipients=1000 --fault-after-ms=3000 --timeout-ms=180000

echo "Local combined regression helper passed. Final release approval still requires the GitHub combined-final workflow for Gitleaks, CodeQL, isolated production-infrastructure validation, and authoritative lane aggregation."
