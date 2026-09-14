#!/usr/bin/env bash
set -euo pipefail

required_branches=(
  main
  audit/mock-hardcoded-data
  test/e2e-full-browser
  test/security-full-audit
  test/stress-soak
)

for branch in "${required_branches[@]}"; do
  remote_ref="refs/remotes/origin/${branch}"
  echo "Fetching ${branch}..."
  if ! git fetch --no-tags origin "+refs/heads/${branch}:${remote_ref}"; then
    echo "Required QA branch '${branch}' is unavailable. Do not run combined-final validation yet." >&2
    exit 1
  fi

  if ! git merge-base --is-ancestor "${remote_ref}" HEAD; then
    echo "HEAD does not contain the latest '${branch}' tip." >&2
    echo "Finalize/merge the primary QA branches, update this branch from the new combined main, then rerun." >&2
    exit 1
  fi
done

required_files=(
  tests/production-mock-audit.test.ts
  e2e/route-inventory.e2e.ts
  e2e/support/full-stack.ts
  playwright.security.config.ts
  apps/load-test/src/stress-suite.ts
  apps/load-test/src/recovery.ts
  apps/load-test/src/webhook-status-flood.ts
  scripts/qa/validate-production-infra.sh
  qa/mock-hardcoded-baseline.json
)

for file in "${required_files[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "Combined-final contract is missing required artifact: $file" >&2
    exit 1
  fi
done

node <<'NODE'
const pkg = require('./package.json');
const required = ['test:e2e', 'test:security', 'load:stress', 'load:recovery', 'load:chaos', 'load:webhook-status', 'qa:mock-audit'];
for (const script of required) {
  if (!pkg.scripts?.[script]) {
    console.error(`Combined-final contract is missing package script: ${script}`);
    process.exit(1);
  }
}
const baseline = require('./qa/mock-hardcoded-baseline.json');
if (!baseline.generatedFrom || String(baseline.generatedFrom).startsWith('PENDING_')) {
  console.error('Mock/hardcoded audit baseline has not yet been reviewed against the combined application.');
  console.error('After the audit branch is merged and this branch is updated, review findings and write the baseline before final validation.');
  process.exit(1);
}
NODE

echo "Combined QA ancestry and final-gate contract verified."
