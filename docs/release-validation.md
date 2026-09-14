# Final integrated regression gate

`test/full-regression-gate` is the final production-readiness regression branch, but it is intentionally **not complete yet**. A passing preflight on this branch must never be presented as validation of the combined application.

## Required integration order

The authoritative final run happens only after this sequence is complete:

1. finalize and merge `audit/mock-hardcoded-data`
2. finalize and merge `test/e2e-full-browser`
3. finalize and merge `test/security-full-audit`
4. finalize and merge `test/stress-soak`
5. update/rebase `test/full-regression-gate` from the new combined `main`
6. review and write the mock/hardcoded audit baseline for that combined tree
7. dispatch `Full Regression Gate` with `scope=combined-final`

The `combined-final` workflow first fetches `main` and all four QA branches and requires every latest branch tip to be an ancestor of `HEAD`. This prevents an older regression branch from certifying itself. The ordinary push workflow runs only `Preparation check (NOT final release validation)`.

Do not mark the regression PR ready for review, and do not call the branch complete, until the combined-final run is green.

## Safety invariants

Release validation must never depend on production/customer state or credentials.

- Core/browser/security lanes use fresh GitHub Actions PostgreSQL and Valkey services with dedicated `whatsapp_qa_*` database names.
- `QA_DISPOSABLE_INFRA=1` is mandatory and `scripts/qa/assert-test-env.ts` rejects remote database/cache hosts, non-QA database names, real-looking Meta/R2 secrets, and non-local E2E Meta/R2 endpoints.
- `LOAD_ALLOW_REMOTE=1` is forbidden. The stress harness uses its existing local fake Meta redirect/fake Graph API and isolated load PostgreSQL/Valkey ports.
- Browser E2E uses `E2E_BLOCK_EXTERNAL=1`, its local fake Meta server, and local fake object storage. It must not contact Meta or R2.
- Production infrastructure validation copies `.env.production.example`, builds local images, and starts disposable local containers only.
- No lane may rely on an existing developer database, Redis/Valkey state, customer seed data, real customer credentials, real Meta credentials, or real R2 credentials.

## Final combined lanes

The explicit `combined-final` run executes these independent lanes after the ancestry/contract check:

- clean migration drift check, database migrations, schema verification, unit/integration tests, critical webhook reliability tests, typecheck and production build
- full functional browser E2E using the merged browser harness across its configured projects
- full security suite plus high/critical dependency audit
- Gitleaks full-history secret scanning
- CodeQL JavaScript/TypeScript `security-extended` static analysis
- mock/hardcoded-data regression audit against a reviewed combined-main baseline
- progressive load smoke, duplicate/out-of-order webhook status smoke, 429/500 recovery smoke, Valkey restart and worker restart smoke
- production Docker/Compose/Caddy/Prometheus/migration/health/metrics validation

The final `Combined application release gate` succeeds only when every lane above succeeds.

## Mock/hardcoded audit baseline

The audit branch currently provides an inventory test that reports suspicious production literals. Reporting alone is not a regression gate, so this branch adds `scripts/qa/mock-hardcoded-regression.ts` and `qa/mock-hardcoded-baseline.json`.

The committed baseline is deliberately `PENDING_COMBINED_MAIN` now. After the audit branch and the other primary QA branches are merged and this branch is updated, run the inventory, review every retained finding, then explicitly write the reviewed baseline:

```bash
bun scripts/qa/mock-hardcoded-regression.ts --write-baseline --reviewed
```

Never auto-update this baseline in CI. The normal `bun run qa:mock-audit` command fails for any suspicious production finding not present in the reviewed baseline.

## Local combined helper

`bun run qa:release` is useful only after the combined-base ancestry and audit-baseline prerequisites are satisfied and only when the caller has provisioned disposable local infrastructure. Set at minimum:

```bash
export QA_DISPOSABLE_INFRA=1
export DATABASE_URL=postgres://whatsapp:whatsapp@127.0.0.1:5432/whatsapp_qa_local
export REDIS_URL=redis://127.0.0.1:6379
export BETTER_AUTH_URL=http://127.0.0.1:3000
export BETTER_AUTH_SECRET=test-only-better-auth-secret-that-is-long-enough
export AUTH_EMAIL_CAPTURE_FILE=/tmp/wa-auth-emails.jsonl
export META_GRAPH_API_VERSION=v26.0
export META_APP_ID=123456789
export META_APP_SECRET=test-only-meta-secret
export META_CONFIG_ID=test-only-config-id
export META_VERIFY_TOKEN=test-only-verify-token
export CREDENTIAL_ENCRYPTION_KEY="$(openssl rand -base64 32 | tr -d '\n')"
```

This helper is not authoritative final approval because Gitleaks, CodeQL, isolated production-infrastructure validation and final lane aggregation are enforced by GitHub Actions.

## Pull-request checks versus heavy validation

Routine pull requests stay separate from release validation. `CI` owns migration/schema checks, unit/integration tests, typecheck, production build, coverage drift and browser smoke. `Security` owns dependency audit, Gitleaks, CodeQL and security E2E. `Production Infra` invokes the same reusable shell validation used by the final gate, avoiding two copies of production deployment validation logic.

500k datasets, long soak tests and destructive PostgreSQL/Valkey chaos do not belong on routine GitHub-hosted PR runners. Keep those manual/scheduled/on dedicated runners after `test/stress-soak` is integrated. The final combined gate intentionally runs only smoke-sized recovery/chaos scenarios.

Before production, representative staging/VPS infrastructure must still run the progressive heavy series (1k -> 10k -> 50k -> 100k -> 500k), 80 MPS and 1,000 MPS paths, 10 concurrent campaigns, multi-organization/multi-number cases, larger webhook floods, slow/429/5xx Meta simulations, long soak, PostgreSQL pressure and multi-worker chaos.

## Coverage manifest

`qa/coverage-manifest.ts` remains the QA inventory for pages, API routes, major workflows, roles, security boundaries and load scenarios. `bun run qa:coverage` fails when a new Next.js `page.tsx` or API `route.ts` is not registered, when references go stale, or when manifest entries are malformed.

After the four primary QA branches are merged, update this manifest against the combined application before running `combined-final`. Explicit `gap` entries remain visible gaps and do not count as covered.

## Completion criteria

This branch is complete only when the combined application has been updated from the final merged `main` and all required checks are green: unit/integration, build/typecheck, full browser E2E, full security, dependency/secret/static checks, audit regression, load/recovery smoke, webhook reliability, production infrastructure validation, and the final aggregate gate. There must be no unresolved high/critical security issue accepted without review.

Only after that run should the final PR be created or updated and marked ready for review. Do not merge it to `main` unless explicitly instructed.
