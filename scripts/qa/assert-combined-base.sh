#!/usr/bin/env bash
set -euo pipefail

MAIN_REF=refs/remotes/origin/main
SOURCES_FILE=qa/combined-qa-sources.json

echo "Fetching latest main..."
git fetch --no-tags origin "+refs/heads/main:${MAIN_REF}"

if ! git merge-base --is-ancestor "${MAIN_REF}" HEAD; then
  echo "HEAD does not contain the latest main." >&2
  echo "Update/rebase test/full-regression-gate from the combined main before final validation." >&2
  exit 1
fi

if [[ ! -f "$SOURCES_FILE" ]]; then
  echo "Missing $SOURCES_FILE. Combined QA integration has not been recorded." >&2
  exit 1
fi

node <<'NODE' > /tmp/combined-qa-integrations.tsv
const sources = require('./qa/combined-qa-sources.json');
const required = [
  'audit/mock-hardcoded-data',
  'test/e2e-full-browser',
  'test/security-full-audit',
  'test/stress-soak',
];
for (const branch of required) {
  const commit = sources[branch];
  if (!commit || String(commit).startsWith('PENDING_')) {
    console.error(`QA integration record is pending for ${branch}.`);
    process.exit(1);
  }
  if (!/^[0-9a-f]{40}$/i.test(commit)) {
    console.error(`QA integration record for ${branch} is not a full commit SHA: ${commit}`);
    process.exit(1);
  }
  console.log(`${branch}\t${commit}`);
}
NODE

while IFS=$'\t' read -r branch commit; do
  if ! git cat-file -e "${commit}^{commit}" 2>/dev/null; then
    echo "Recorded integration commit for ${branch} is not available from latest main: ${commit}" >&2
    exit 1
  fi
  if ! git merge-base --is-ancestor "$commit" "$MAIN_REF"; then
    echo "Recorded integration commit for ${branch} is not part of latest main: ${commit}" >&2
    exit 1
  fi
  if ! git merge-base --is-ancestor "$commit" HEAD; then
    echo "Regression HEAD does not contain the recorded ${branch} integration commit: ${commit}" >&2
    exit 1
  fi
  echo "Verified ${branch} integration at ${commit}."
done < /tmp/combined-qa-integrations.tsv

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
  console.error('After the QA branches are integrated and this branch is updated, review findings and write the baseline before final validation.');
  process.exit(1);
}
NODE

echo "Combined main ancestry, QA integration records, and final-gate contract verified."
