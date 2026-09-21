# Release controls for `main`

This runbook implements the repository-side controls for **issue #91** (`[P0] Enforce protected main and required release checks`) and the release-control gap recorded in section 2 of `docs/production-readiness-plan.md`.

> **Status: applied and verified (2026-09-20).** The ruleset in [`.github/rulesets/main.json`](../.github/rulesets/main.json) was POSTed by the repository owner and is live as ruleset `main-release-controls`, **`id` `23732752`**, `enforcement: active`. All five required checks are enforced, and both test PRs required by issue #91 are recorded in [section 11](#11-test-pr-verification-issue-91-acceptance-evidence): the red case is [PR #100](https://github.com/yasserfullstack-tech/whatsapp/pull/100) (blocked, closed unmerged) and the green case is [PR #96](https://github.com/yasserfullstack-tech/whatsapp/pull/96) (merged as `b206bcc`). **Do not run the section 6 command again** — a second POST creates a second, duplicate ruleset rather than updating this one; changes go through the `PUT` in section 7.

- Ruleset-as-code: [`.github/rulesets/main.json`](../.github/rulesets/main.json)
- Live ruleset: `main-release-controls`, id `23732752` (applied 2026-09-20)
- Target: `refs/heads/main` (the repository default branch)
- Enforced by: a repository administrator; the non-admin automation account cannot create or modify rulesets
- Evidence to attach to issue #91: the ruleset export, the required-check list, and the red/green test-PR links

## 1. Enforcement model

The repository uses a **repository ruleset** (not classic branch protection). A ruleset is used because:

- it is applied with a single REST call from a committed JSON file, so the reviewed policy and the enforced policy are the same artifact;
- rulesets block force-pushes and branch deletion on the server side, and the bypass list is explicit in the JSON;
- the ruleset has a history endpoint, which gives an auditable record of who changed the policy and when.

The committed ruleset contains exactly these rules:

| Rule | Parameters | Effect |
| --- | --- | --- |
| `deletion` | — | `main` cannot be deleted |
| `non_fast_forward` | — | force-push / history rewrite of `main` is rejected |
| `creation` | — | a `refs/heads/main` branch cannot be (re)created, so a deleted-and-recreated `main` cannot be used to bypass the rules |
| `pull_request` | section 9 | every change to `main` must land through a pull request |
| `required_status_checks` | sections 3 and 4 | the five checks in section 4 must pass on an up-to-date branch before merge |

## 2. How required status-check names are derived (the main failure mode)

A ruleset's `required_status_checks[].context` must match the **check-run name**, not the workflow file name and not the workflow `name:`.

For a job started by GitHub Actions the reported check-run name is:

- the job's `jobs.<id>.name:` value when it is set, otherwise
- the raw job key `jobs.<id>`.

The workflow `name:` is **not** part of the check name. This was verified against this repository with read-only API calls rather than assumed:

```bash
# checks reported on the current main HEAD (push events)
gh api 'repos/yasserfullstack-tech/whatsapp/commits/main/check-runs?per_page=100' \
  --jq '.check_runs[] | "\(.app.slug)\t\(.name)\t\(.status)\t\(.conclusion)"'
```

Recorded output (2026-09-19, `main` at `86ccafc`):

```text
github-actions  Dependency audit                      completed  success
github-actions  Tenant isolation and API abuse tests  completed  success
github-actions  CodeQL                                completed  success
github-actions  Secret scan                           completed  success
github-actions  checks                                completed  success
github-actions  smoke                                 completed  failure
```

Three things are visible in that output, and all three matter:

1. `ci.yml` declares `name: CI`, but its only job is `jobs.checks` with no `name:`, so the check is named **`checks`**. No check is named `CI` or `CI / checks`.
2. Every `security.yml` job declares `name:`, so the checks are **`Dependency audit`**, **`Secret scan`**, **`CodeQL`** and **`Tenant isolation and API abuse tests`** — never `Security / ...`.
3. `smoke` (the `Load Smoke` job) is **failing on `main` today** while its commit stayed merged. That is exactly the risk in issue #91, and it is also why `smoke` is deliberately *not* a required check (section 3): it has no `pull_request` trigger, so requiring it would block every PR forever instead of blocking the bad commit.

Cross-check on a pull request (PR #89, head `c3917c1`) — this is the check set a PR actually reports, including the conditional jobs:

```text
github-actions           checks                                completed  success
github-actions           Dependency audit                      completed  success
github-actions           Secret scan                           completed  success
github-actions           CodeQL                                completed  success
github-advanced-security CodeQL                                completed  success
github-actions           Tenant isolation and API abuse tests  completed  success
github-actions           validate                              completed  success
github-actions           load-validation                       completed  skipped
github-actions           webhook-flood-100k                    completed  skipped
```

`validate` appears because that PR touched `.github/workflows/production-infra.yml`'s path filter; on a PR that does not, the `Production Infra` workflow never starts and no `validate` check exists at all. The two `skipped` checks confirm the conditional-job behaviour described in section 3. `CodeQL` is reported by two apps on PRs, and GitHub requires every check with a required name to pass.

## 3. Every workflow: required, or not

All ten workflow files in `.github/workflows/` were read directly. Does the check get reported for **every** pull request targeted at `main`? That single question decides the column, and the `on:` and job-level `if:` values in the reason column are the evidence.

| Workflow file | Workflow `name:` | Job (`jobs.<id>`) | Reported check name | Required | Reason |
| --- | --- | --- | --- | --- | --- |
| `.github/workflows/ci.yml` | `CI` | `checks` (no `name:`) | `checks` | **YES** | `on: pull_request:` with no `paths`/`branches` filter and no job-level `if:` — runs for every PR. It is the build/test/typecheck/migration/browser-E2E baseline. |
| `.github/workflows/security.yml` | `Security` | `dependency-audit` (`name: Dependency audit`) | `Dependency audit` | **YES** | Same workflow, unconditional `pull_request`, no `if:`. Blocking HIGH/CRITICAL dependency gate. |
| `.github/workflows/security.yml` | `Security` | `secret-scan` (`name: Secret scan`) | `Secret scan` | **YES** | Same workflow. Gitleaks over full history. |
| `.github/workflows/security.yml` | `Security` | `codeql` (`name: CodeQL`) | `CodeQL` | **YES** | Same workflow. CodeQL `security-extended` JavaScript/TypeScript. The code-scanning default setup reports a second `CodeQL` check from the `github-advanced-security` app; both must pass. |
| `.github/workflows/security.yml` | `Security` | `security-e2e` (`name: Tenant isolation and API abuse tests`) | `Tenant isolation and API abuse tests` | **YES** | Same workflow. `bun run test:security` tenant-isolation and API-abuse suite. |
| `.github/workflows/production-infra.yml` | `Production Infra` | `validate` (no `name:`) | `validate` | **NO** | `pull_request` is **`paths:`-filtered** (`apps/web/next.config.ts`, `apps/{web,api,worker}/**`, `packages/**`, `package.json`, `bun.lock`, `docker-compose.production.yml`, `infra/{docker,production}/**`, `.dockerignore`, `.env.{production,staging}.example`, the workflow file itself and `docs/deployment.md`/`docs/production-infrastructure.md`). GitHub leaves the checks of a workflow skipped by path filtering in `Pending`, so requiring it would permanently block every PR that does not touch those paths. The gate is real, and since 2026-09-21 it is also run **pre-merge** by the always-on `release-gate` aggregator (section 12 item 1), which is not a required check yet. |
| `.github/workflows/backup-recovery.yml` | `Backup Recovery` | `validate` (no `name:`) | `validate` | **NO** | Path-filtered `pull_request` (backup scripts, `infra/production/systemd/**`, backup/DR docs) — same pending-forever problem. Its check name `validate` is also indistinguishable from `Production Infra`'s `validate`, so a required `validate` could not state which workflow it meant. |
| `.github/workflows/reporting-scale.yml` | `Reporting Scale` | `reporting-scale` (`name: ${{ matrix.name }} reporting dataset`) | `small reporting dataset`, `100k reporting dataset`, `500k reporting dataset` | **NO** | Path-filtered `pull_request`, and the check name is generated per matrix entry, so the required-check list would have to hard-code three threshold labels that change whenever the matrix changes. |
| `.github/workflows/webhook-reliability-validation.yml` | `Webhook Reliability Load Validation` | `load-validation`; `webhook-flood-100k` (no `name:` on either) | `load-validation`, `webhook-flood-100k` | **NO** | The workflow does trigger on every PR to `main`, but both jobs are gated by `if: github.head_ref == 'feat/webhook-reliability'`. GitHub documents that a job skipped by a conditional reports **"Success"**, so requiring these would show a green required check on every ordinary PR while running nothing — a silently bypassed release gate, which issue #91 explicitly forbids. `webhook-flood-100k` also `needs: load-validation`, and a dependent job skipped because its dependency did not run may not block merging at all (PR #89 head `c3917c1` shows both as `skipped`). |
| `.github/workflows/load-smoke.yml` | `Load Smoke` | `smoke` (no `name:`) | `smoke` | **NO** | No `pull_request` trigger at all (`push` to `main`/`test/load-testing`, plus `workflow_dispatch`), so the check is never reported on a PR and a required `smoke` would block forever. The name `smoke` also collides with `onboarding-load-smoke.yml`. This is the workflow that is currently failing on `main`; today it is a post-merge release-health signal, not a merge gate. Owned by issue #90 — this change did not modify it. |
| `.github/workflows/onboarding-load-smoke.yml` | `Onboarding Load Smoke` | `smoke` (no `name:`) | `smoke` | **NO** | `push` to `feat/onboarding-v2` only, so it never runs for PRs to `main`; also collides with `load-smoke.yml`'s `smoke`. |
| `.github/workflows/final-regression-gate.yml` | `Final Regression Gate` | `application-regression`, `security-regression`, `load-resilience`, `production-runtime`, `final-gate` (`name:` on each) | `Application and browser regression`, `Tenant isolation and API abuse regression`, `Safe local load and recovery regression`, `Production image and runtime regression`, `Final integrated regression gate` | **NO** | Triggered only by `push` to `test/full-regression-gate-final` and `workflow_dispatch`, so it never reports on a PR to `main`; requiring it would block every PR forever. It is the pre-release gate, run deliberately before a release. |
| `.github/workflows/stress-soak.yml` | `Stress and Soak Validation` | `branch-validation`; `dedicated-benchmark` (no `name:` on either) | `branch-validation`, `dedicated-benchmark` | **NO** | `push` to `test/stress-soak` plus `schedule` and `workflow_dispatch` — manual and scheduled certification runs, never a per-PR check. |

**Decision:** five required checks, all produced by the two workflows that run unconditionally on every pull request to `main`. Nothing else is added until the path-filtered and branch-scoped gates are restructured (section 12), because a required check that is never reported blocks every PR forever, and a required check whose job is conditionally skipped reports success while validating nothing. The path-filtered gates are now restructured as the always-on `release-gate` aggregator (section 12 item 1); that check is **not** required yet, so the five checks below are still the enforced set.

## 4. Final required-check list

This is the exact content of `rules.required_status_checks.parameters.required_status_checks` in [`.github/rulesets/main.json`](../.github/rulesets/main.json):

| # | `context` (exact string) | Producer workflow | What it actually gates |
| --- | --- | --- | --- |
| 1 | `checks` | `CI` (`.github/workflows/ci.yml`) | frozen-lockfile install, Drizzle migration-drift check, migrate + schema verify, `bun test`, `bun run typecheck`, `bun run build`, Playwright EN/AR desktop/tablet/mobile E2E |
| 2 | `Dependency audit` | `Security` (`.github/workflows/security.yml`) | `bun audit --audit-level=high` — fails on HIGH/CRITICAL advisories |
| 3 | `Secret scan` | `Security` (`.github/workflows/security.yml`) | gitleaks over the full repository history |
| 4 | `CodeQL` | `Security` (`.github/workflows/security.yml`), plus code-scanning default setup | CodeQL `security-extended` JavaScript/TypeScript analysis |
| 5 | `Tenant isolation and API abuse tests` | `Security` (`.github/workflows/security.yml`) | `bun run test:security` tenant-isolation and API-abuse suite |

`strict_required_status_checks_policy: true` additionally requires the PR branch to be up to date with `main` before merge, so a green check from a stale base cannot be reused.

## 5. Required-check semantics: `Pending` vs `Success`

The ruleset deliberately requires only checks that are always reported, because GitHub distinguishes two failure modes that look similar in the UI but behave oppositely. From GitHub's *Troubleshooting required status checks* documentation (https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks):

| Situation | Result | Documented guidance |
| --- | --- | --- |
| "A workflow is skipped by path filtering, branch filtering, or a commit message" | "Associated checks stay in a `Pending` state and block merging" | "Avoid requiring workflows that can be skipped." |
| "A job is skipped by a conditional" | "The job reports `Success`" | — |
| "A job depends on a failed job" | "The dependent job is skipped and may not block merging" | "Use `always()` with `needs` for required checks that depend on other jobs." |

The same page also states that a check created by a workflow job is only evaluated for pull requests when the run was triggered by `push`, `pull_request`, `pull_request_review`, `pull_request_target`, `deployment` or `deployment_status`; a `workflow_dispatch` run on a PR head branch does not satisfy a required check.

Applied to this repository:

- `Production Infra`, `Backup Recovery` and `Reporting Scale` are **path-filtered**, so they are in the first row: requiring them would leave every unrelated PR stuck on "Waiting for status to be reported" forever.
- `Webhook Reliability Load Validation` is in the second row: its jobs are conditionally skipped, so a required check there would be green on every ordinary PR.
- `Final Regression Gate`, `Stress and Soak Validation`, `Load Smoke` and `Onboarding Load Smoke` are dispatch/schedule/branch-scoped, so their checks are not reported on PRs at all.
- None of the five required checks in section 4 has a job-level condition or a `needs:` dependency, so the third row does not apply to them today. If a required job ever gains `needs:`, it must keep an `always()` guard or the requirement must be moved to a dedicated gate job.

## 6. Apply the ruleset (repository administrator)

Merging [`.github/rulesets/main.json`](../.github/rulesets/main.json) changes nothing on its own; the file is inert until an administrator POSTs it. From the repository root, on `main` (or a branch where the file exists), the owner runs exactly one command:

```bash
gh api --method POST repos/yasserfullstack-tech/whatsapp/rulesets --input .github/rulesets/main.json
```

Notes for the person running it:

- It requires `admin` on `yasserfullstack-tech/whatsapp`. An account with only `write`/`triage` (the automation account used for the rest of this repository's work) receives HTTP 403 — that is expected and is not a sign that the JSON is wrong.
- `--input` sends the committed file verbatim as a JSON request body, so what is reviewed in git is exactly what is enforced.
- `gh` resolves `repos/OWNER/REPO/rulesets` against the API of the authenticated host; run it with the account that owns the repository.
- On success the response echoes the created ruleset and its `id`. Record that `id`; it is needed for verification, changes and rollback (section 7).
- On failure the API returns 422/403 and **nothing is applied** — the request is atomic, so a rejected payload cannot leave a partially enforced policy.

## 7. Verify, change or roll back

Verify (read-only):

```bash
# 1. the ruleset exists and is active
gh api repos/yasserfullstack-tech/whatsapp/rulesets \
  --jq '.[] | {id, name, target, enforcement}'

# 2. the exact enforced rules, including every required check context
gh api repos/yasserfullstack-tech/whatsapp/rulesets/<RULESET_ID> \
  --jq '{name, enforcement, rules: [.rules[] | {type, parameters}]}'

# 3. the rules that actually apply to refs/heads/main
gh api repos/yasserfullstack-tech/whatsapp/rules/branches/main --jq '[.[] | .type]'
```

Expected: one ruleset, `target: branch`, `enforcement: active`, five rule types (`deletion`, `non_fast_forward`, `creation`, `pull_request`, `required_status_checks`) and exactly the five contexts listed in section 4.

Recorded output (2026-09-20, ruleset id `23732752`):

```text
$ gh api repos/yasserfullstack-tech/whatsapp/rulesets --jq '.[] | {id, name, target, enforcement}'
{"enforcement":"active","id":23732752,"name":"main-release-controls","target":"branch"}

$ gh api repos/yasserfullstack-tech/whatsapp/rulesets/23732752 --jq '{name, enforcement, rules: [.rules[] | {type, parameters}]}'
required_status_checks contexts: checks, Dependency audit, Secret scan, CodeQL, Tenant isolation and API abuse tests
strict_required_status_checks_policy: true
pull_request: required_approving_review_count 0, required_review_thread_resolution true

$ gh api repos/yasserfullstack-tech/whatsapp/rules/branches/main --jq '[.[] | .type]'
["deletion","non_fast_forward","creation","pull_request","required_status_checks"]
```

One operational consequence of `required_review_thread_resolution: true`: a review comment left by a bot counts as an unresolved conversation and blocks the merge until it is resolved, so resolve (or answer and resolve) review threads rather than using administrator override.

Change:

```bash
# edit the file, commit it, then push the new policy
gh api --method PUT repos/yasserfullstack-tech/whatsapp/rulesets/<RULESET_ID> \
  --input .github/rulesets/main.json
```

Roll back (re-opens the release-control gap — record the reason in issue #91):

```bash
gh api --method DELETE repos/yasserfullstack-tech/whatsapp/rulesets/<RULESET_ID>
```

## 8. Force-push and deletion policy

| Rule | Policy | Consequence to be aware of |
| --- | --- | --- |
| `non_fast_forward` | Force-push / history rewrite of `main` is rejected for every actor. | `git push --force` (or `--force-with-lease`) to `main` fails. A secret accidentally committed to `main` must be **rotated**, not scrubbed by rewriting history; the gitleaks `Secret scan` check exists to catch it before merge. |
| `deletion` | `main` cannot be deleted. | `git push origin --delete main` fails, as does deletion from the branch UI. |
| `creation` | `refs/heads/main` cannot be (re)created. | If `main` were ever removed out of band, it could not be silently recreated outside these rules. |
| `required_linear_history` | **Not configured.** | The repository currently uses merge commits on `main` (for example `8a20321`, `d8a55ed`) and allows merge, squash and rebase. Forcing linear history is a separate policy decision and is deliberately left out so that the ruleset does not change the repository's merge methods. `allowed_merge_methods` is likewise left at the repository default. |

Section 12 records the follow-up to re-evaluate linear history when the branch/merge strategy is settled.

## 9. Pull-request policy: approvals and code-owner review

The `pull_request` rule parameters in the committed JSON are:

| Parameter | Value | Why |
| --- | --- | --- |
| `required_approving_review_count` | `0` | **Deliberate, and the most important judgement call in this document.** GitHub does not let an author approve their own PR, and every recent PR in this repository was authored *and* merged by `yasserfullstack-tech` (PRs #85–#89), with the only reviews being `COMMENTED` from `chatgpt-codex-connector[bot]`; there is no record of a human `APPROVED` review from the second collaborator. Requiring one approval today would block 100% of PRs indefinitely — the same class of failure as a required check that never reports. |
| `dismiss_stale_reviews_on_push` | `true` | Inert while the count is 0; correct as soon as the count is raised. |
| `require_code_owner_review` | `false` | No `CODEOWNERS` file exists in this repository (`.github/CODEOWNERS`, `CODEOWNERS` and `docs/CODEOWNERS` are all absent), so there are no code owners to review. Add `CODEOWNERS` first, then enable this. |
| `require_last_push_approval` | `false` | Only meaningful when at least one approval is required. With a single active reviewer it would re-block the PR after every push. |
| `required_review_thread_resolution` | `true` | Works today: unresolved review conversations block the merge, including conversations started by the review bot. This is the substance of "review happened" that is enforceable without deadlocking. |

**Decision: pull requests are mandatory for `main`; approvals are not enforced by the ruleset yet.**

- Direct unreviewed pushes are prevented: `required_approving_review_count: 0` still means every change — including the owner's — must arrive through a pull request whose five required checks pass.
- Human approval remains required **by policy**, recorded in the PR description and review threads, but it is not machine-enforced until a second human reviewer is reliably available.
- Recommendation, with the trigger for changing it: when two humans are actively reviewing, edit `.github/rulesets/main.json` to `"required_approving_review_count": 1`, set `"require_last_push_approval": true`, and re-apply with the `PUT` command in section 7. Do not set it earlier; an approval rule nobody can satisfy is a release outage, not a control.

## 10. Administrator bypass and audit expectations

`bypass_actors` is an **empty array**: there is no standing administrator, team or app bypass.

- Rationale: this repository is owned by a personal user account (`owner.type == "User"`), so `OrganizationAdmin` bypass is not applicable, and `RepositoryRole` bypass values are well-known but not officially documented by GitHub. A wrong `actor_id` would grant bypass to the wrong role — an unacceptable risk in the one control whose purpose is to prevent bypass. If a standing bypass is ever wanted, add it through the repository UI (**Settings → Rules → Rulesets → Bypass list**), where the role is selected by name, and then copy the resulting JSON back into `.github/rulesets/main.json` so the file and the server stay identical.
- Rulesets are enforced server-side, so the rules above bind administrators too. What an administrator *can* still do is change or delete the ruleset itself. That is the **documented emergency path**, and it is a policy change rather than a merge action.

**Emergency path (the only one):** if `main` must change urgently and the required checks cannot run (for example a GitHub Actions outage), the repository owner may temporarily relax the ruleset — `PUT` with `"enforcement": "evaluate"` or `DELETE` — land the fix through a PR, then restore the ruleset immediately. Every use must be recorded in issue #91 with the timestamp, the reason, the commit, and the restore confirmation. Emergency bypass is never a standing configuration.

**Audit expectations:**

| What to check | How |
| --- | --- |
| Who changed the enforced policy, and when | `gh api repos/yasserfullstack-tech/whatsapp/rulesets/<RULESET_ID>/history` (ruleset history) |
| Whether any bypass was used | With an empty `bypass_actors` there is nothing to reconcile; any direct push to `main` would have to have gone through a ruleset change, which the history above records |
| Whether the policy is still active | The three read-only commands in section 7, plus the ruleset export attached to issue #91 |
| Whether a red gate landed anyway | `push`-triggered runs on `main` (`CI`, `Security`, `Production Infra`, `Load Smoke`) remain the independent post-merge detector; a red run on `main` means a policy change was made or a check is flaky, and must be triaged either way |

Because this is a personal public repository, there is no organization audit-log API; the ruleset history endpoint, the committed JSON file and the record in issue #91 are the audit trail.

## 11. Test-PR verification (issue #91 acceptance evidence)

Run these **after** the ruleset is active (section 6) and after the verification commands in section 7 pass. Both PRs must target `main` and be based on its then-current HEAD, because `strict_required_status_checks_policy` requires the branch to be up to date. Use an account with push access; the ruleset itself is what is being tested, not the account.

### 11.1 Red PR — a failing required check must block merge

The probe is a deliberately failing unit test rather than a workflow edit: `bun run test` is a step inside the required `checks` job, so a failing test deterministically fails a required check on any file path, and no workflow that another issue owns is touched. The file must never be merged.

```bash
git fetch origin main
git checkout -b test/branch-protection-red-probe origin/main
printf '%s\n' 'import { expect, test } from "bun:test";' '' 'test("deliberate red probe for issue #91", () => {' '  expect(1).toBe(2);' '});' \
  > apps/web/lib/branch-protection-red-probe.test.ts
git add apps/web/lib/branch-protection-red-probe.test.ts
git commit -m "test: deliberate red probe for required-check enforcement (#91)"
git push -u origin test/branch-protection-red-probe
gh pr create --base main --head test/branch-protection-red-probe \
  --title "RED probe (do not merge): required check must block this PR (#91)" \
  --body "Verifies issue #91: a failing required check blocks merge. Expected failing check: \`checks\` (CI / bun run test)."
```

Expected result — all four observations are the evidence:

1. The `checks` check-run on the PR head completes with conclusion `failure` (it fails at the `bun run test` step).
2. The other required checks (`Dependency audit`, `Secret scan`, `CodeQL`, `Tenant isolation and API abuse tests`) may still be pending or green; they do not matter.
3. The merge box reports `Required status check "checks" is failing` (or `Waiting for status to be reported` while it runs) and the **Merge pull request** button is disabled.
4. An attempted `gh pr merge test/branch-protection-red-probe --squash` is rejected with the same required-check error.

Capture a screenshot of the failing check plus the blocked merge box, and the PR URL.

Cleanup: `gh pr close test/branch-protection-red-probe --delete-branch`, delete `apps/web/lib/branch-protection-red-probe.test.ts` from the working tree if it was ever copied elsewhere, and confirm with `git log origin/main -- apps/web/lib/branch-protection-red-probe.test.ts` that the probe never reached `main`.

### 11.2 Green PR — a fully green change must merge normally

```bash
git fetch origin main
git checkout -b test/branch-protection-green-probe origin/main
# a small, keepable, non-behavioural change, for example a one-line clarification
# in docs/release-controls.md; commit it normally
git add docs/release-controls.md
git commit -m "docs: note verified release controls (#91)"
git push -u origin test/branch-protection-green-probe
gh pr create --base main --head test/branch-protection-green-probe \
  --title "GREEN probe: required checks pass and merge is allowed (#91)" \
  --body "Verifies issue #91: a fully green change can merge normally. Expect all five required checks green."
```

Expected result:

1. All five required checks are reported and conclude `success` — exactly `checks`, `Dependency audit`, `Secret scan`, `CodeQL`, `Tenant isolation and API abuse tests`.
2. The merge box shows every required check green and **Merge pull request** is enabled with no "Waiting for status to be reported" entries. If `main` advanced in the meantime, use **Update branch** first — that is `strict_required_status_checks_policy` working as intended.
3. Merging succeeds (do this only if the change is worth keeping; otherwise record the screenshot and close the PR). A rejected merge here would mean the required set contains a check that is never reported — go back to sections 3 and 5.

Capture a screenshot of the five green required checks with the enabled merge button, and the PR URL.

### 11.3 Optional: direct-push rejection

`gh api repos/yasserfullstack-tech/whatsapp/rules/branches/main --jq '[.[] | .type]'` already shows `non_fast_forward` and `deletion`. To observe it directly, from a local clone on `main`:

```bash
git commit --allow-empty -m "probe: direct push must be rejected (#91)"
git push origin main
# expected: remote: error: GH006: Protected branch update failed for refs/heads/main.
```

This is optional because it pushes a real (if empty) commit attempt at `main`. If it unexpectedly succeeds, stop and report immediately: it means a bypass actor or an inactive ruleset exists, and the commit is harmless but the policy is not.

### 11.4 Recorded results (2026-09-20)

Both probes ran against ruleset `23732752`, on base `main` at `8c37354`.

**Red — [PR #100](https://github.com/yasserfullstack-tech/whatsapp/pull/100)** (`test/branch-protection-red-probe`, head `2ff9b54`, one deliberately failing `bun:test` file at `apps/web/lib/branch-protection-red-probe.test.ts`):

```text
checks                                FAILURE   (28s, failed at the bun run test step)
Dependency audit                      SUCCESS
Secret scan                           SUCCESS
gh pr view 100 --json mergeable,mergeStateStatus  ->  {"mergeable":"MERGEABLE","mergeStateStatus":"BLOCKED"}
gh pr merge 100 --squash  ->  X Pull request #100 is not mergeable: the base branch policy prohibits the merge.
```

Cleanup performed: PR closed, branch `test/branch-protection-red-probe` deleted, and `git log origin/main -- apps/web/lib/branch-protection-red-probe.test.ts` returns nothing, so the probe never reached `main`.

**Green — [PR #96](https://github.com/yasserfullstack-tech/whatsapp/pull/96)** (`feat/campaign-scheduling-61`, head `4ab4cbf`), merged as `b206bcc`:

```text
checks                                SUCCESS
Dependency audit                      SUCCESS
Secret scan                           SUCCESS
CodeQL                                SUCCESS   (Actions job)
CodeQL                                SUCCESS   (github-advanced-security / code-scanning default setup)
Tenant isolation and API abuse tests  SUCCESS
mergeStateStatus CLEAN -> merged, gated by the ruleset
```

Evidence here is API output (check-run conclusions, `mergeStateStatus`, and the rejected/allowed merge commands) rather than screenshots; it captures the same observations the screenshots would.

## 12. Known gaps and follow-up work

These are deliberate, documented gaps. They are **not** reasons to leave the ruleset unapplied — the five enforced checks are a strict improvement over zero enforcement.

1. **Path-filtered release gates: the always-on aggregator exists and `release-gate` is now a required check (was the highest-value follow-up; enforced 2026-09-22).** `Production Infra`, `Backup Recovery` and `Reporting Scale` are real release gates but are path-filtered, so requiring them directly would block every unrelated PR. [`.github/workflows/release-gate.yml`](../.github/workflows/release-gate.yml) now implements the structural fix. It is triggered by `pull_request` to `main` with **no path filter** and:
   - runs a lightweight `changes` job that computes the pull request's changed files (the merge-base diff of `base.sha`..`head.sha`) and emits one output per path group — `infra`, `backup`, `reporting`. Each group's pattern list is exactly the `paths:` entries of the corresponding workflow.
   - runs the three validations as **copies** of the existing jobs, each guarded by `if: needs.changes.outputs.<group> == 'true'`. A job skipped by a conditional reports `Success`, so an unrelated PR is not blocked (section 5).
   - ends in a `release-gate` job with `needs:` on all four and `if: always()` that asserts every `needs.*.result` explicitly: `success` passes, `skipped` passes only when that gate was not applicable, and anything else fails — **including `changes` itself**, so a detector failure cannot produce a false green.

   The jobs are **copied rather than called as reusable `workflow_call` workflows**, which was the first design tried and rejected. Adding `workflow_call:` to the three workflows is itself an edit to files that sit inside their own `paths:` groups, so every branch carrying the aggregator reports all three gates as applicable and the "an unrelated PR runs nothing" case cannot be exercised at all; GitHub also refuses to load the workflow when a `uses:` target is not callable, even if that job would be skipped. Copying leaves the three existing workflows byte-for-byte unchanged — triggers, job names, steps and post-merge behaviour included. The cost is drift between a copy and its source: the workflow header carries a `KEEP IN SYNC` note, and the post-merge runs on `main` remain the independent detector.

   Verified on 2026-09-21 with four throwaway PRs opened against `main`, all closed unmerged:

   | Case | PR | Run | `changes` output | Observed |
   | --- | --- | --- | --- | --- |
   | green A — unrelated path only (`README.md`) | [#121](https://github.com/yasserfullstack-tech/whatsapp/pull/121) | [35652867649](https://github.com/yasserfullstack-tech/whatsapp/actions/runs/35652867649) | `infra=false backup=false reporting=false` | all three gates `skipped`; `release-gate` **pass** |
   | green B — `packages/**` plus a reporting path | [#122](https://github.com/yasserfullstack-tech/whatsapp/pull/122) | [35652880593](https://github.com/yasserfullstack-tech/whatsapp/actions/runs/35652880593) | `infra=true backup=false reporting=true` | infra and reporting run and pass, backup `skipped`; `release-gate` **pass** |
   | red 1 — one gate forced to fail (`docs/backups.md`) | [#123](https://github.com/yasserfullstack-tech/whatsapp/pull/123) | [35652888372](https://github.com/yasserfullstack-tech/whatsapp/actions/runs/35652888372) | `infra=false backup=true reporting=false` | `Backup Recovery validation` **fail**; `release-gate` **fail** |
   | red 2 — detector forced to error while a gate was applicable | [#124](https://github.com/yasserfullstack-tech/whatsapp/pull/124) | [35652918453](https://github.com/yasserfullstack-tech/whatsapp/actions/runs/35652918453) | `changes` **fail**, so `infra` never resolved | all three gates `skipped`; `release-gate` **fail** |

   The `release-gate` job's own log is the check on the aggregator logic: for green A it printed `production-infra: applicable=false result=skipped`, `backup-recovery: applicable=false result=skipped`, `reporting-scale: applicable=false result=skipped`, `release-gate: every applicable gate succeeded.`; for red 1 it printed `FAILED backup-recovery: applicable=true result=failure`; for red 2 it printed `FAILED changes: applicable=failure result=failure` **and** `FAILED production-infra: applicable=true result=skipped` — the assertion that stops an applicable-but-skipped gate from passing.

   **Enforced 2026-09-22.** `release-gate` was added to the required status checks as a sixth context (the five existing contexts are unchanged) via [PR #127](https://github.com/yasserfullstack-tech/whatsapp/pull/127), and the ruleset was applied with the `PUT` in section 7. The live ruleset now reads `["checks", "Dependency audit", "Secret scan", "CodeQL", "Tenant isolation and API abuse tests", "release-gate"]` with `strict_required_status_checks_policy: true`. `validate` was **not** removed: it is the path-filtered `Production Infra` check name, it is not in the required list, and its post-merge run on `main` remains the independent detector against aggregator drift.

   Re-verified against the enforced ruleset with one more throwaway PR, closed unmerged:/n/n   | Case | PR | Run | Observed |
   | --- | --- | --- | --- |
   | red — `docker-compose.production.yml` deliberately invalidated | [#128](https://github.com/yasserfullstack-tech/whatsapp/pull/128) | [35663597247](https://github.com/yasserfullstack-tech/whatsapp/actions/runs/35663597247) | `Production Infra validation` **fail**; `release-gate` **failure**; `mergeStateStatus: BLOCKED`; `gh pr merge` rejected with *"base branch policy prohibits the merge"* |

   To revert, remove the `release-gate` entry from `.github/rulesets/main.json` and re-run the `PUT` in section 7. The workflow itself can stay in the tree and keep running — it only stops blocking.
2. **`CodeQL` is reported by two apps.** Required by name, so both the Actions job and the code-scanning default setup must pass. Optional hardening: pin the required check to the GitHub Actions app by adding `"integration_id"` (the app id is visible as `app.id` in the check-runs API; the Actions app is `15368`) once verified in this repository, which prevents name spoofing by a third-party app.
3. **Approvals are 0 (section 9).** Raise to `1` with `require_last_push_approval: true` once a second human reviewer is reliably active, and re-apply with the `PUT` command.
4. **`CODEOWNERS` added (2026-09-21, [PR #126](https://github.com/yasserfullstack-tech/whatsapp/pull/126)); `require_code_owner_review` deliberately still off.** A root `CODEOWNERS` now exists. GitHub reads only the first file it finds, in the order `CODEOWNERS` → `.github/CODEOWNERS` → `docs/CODEOWNERS`, so this repository uses the root file and a second copy must not be added. There is exactly one maintainer, `@yasserfullstack-tech`, so every pattern resolves to the same account: the explicit entries are not multi-team routing, they make ownership of the sensitive areas visible in review and keep the mapping correct if a second maintainer is ever added.

   | Pattern | Area |
   | --- | --- |
   | `*` | default owner for the whole repository |
   | `/.github/` | CI workflows, branch-protection rulesets, PR template |
   | `/infra/`, `/docker-compose.yml`, `/docker-compose.production.yml`, `/docker-compose.load.yml`, `/docker-compose.load-chaos.yml` | deployment and production infrastructure |
   | `/packages/db/` | database schema and migrations |
   | `/packages/billing/`, `/packages/credentials/`, `/packages/auth/`, `/packages/storage/` | money, identity, secret handling, object storage |
   | `/.env.example`, `/.env.production.example`, `/.env.staging.example` | which secrets exist (no secret values) |
   | `/docs/legal/`, `/docs/release-controls.md`, `/docs/production-readiness-plan.md` | legal, compliance and release-control documentation |

   Verified, not assumed. Every pattern was matched against `git ls-files` so that no pattern resolves to an empty set, and GitHub parses the file with zero errors on the branch that adds it:

   ```text
   $ gh api 'repos/yasserfullstack-tech/whatsapp/codeowners/errors?ref=chore/add-codeowners'
   {"errors":[]}
   ```

   That endpoint is not vacuous: a deliberately bogus owner on a throwaway branch returned `{"kind":"Unknown owner","line":2,...}`, so an empty `errors` array also confirms `@yasserfullstack-tech` is a recognised owner with write access. (There is no `repos/.../codeowners` endpoint — it returns 404; `codeowners/errors` is the one to use.)

   `require_code_owner_review` remains **`false`** in [`.github/rulesets/main.json`](../.github/rulesets/main.json). Enabling it changes who can merge, so it is an owner decision rather than part of adding the file, and with a single maintainer it is unlikely to add a working control yet: GitHub never requests review from the author of a pull request, and the only code owner is the account that opens every PR. To enable it once a second human reviewer is active, set `"require_code_owner_review": true` in the `pull_request` rule of `.github/rulesets/main.json`, commit the file, then re-apply with the `PUT` command in section 7:

   ```bash
   gh api --method PUT repos/yasserfullstack-tech/whatsapp/rulesets/23732752 \
     --input .github/rulesets/main.json
   ```

   - Section 9's table row for `require_code_owner_review` describes the state **before** this file existed ("No `CODEOWNERS` file exists in this repository ... all absent"). That clause is now historical; the value it records, `false`, is still correct. It is left as written because section 9 is a record of the decision made at the time.
   - Optional, documented and **not applied** — see item 2: the required `CodeQL` check can be pinned to the GitHub Actions app by adding `"integration_id": 15368` to that check in the ruleset, which prevents a third-party app from spoofing the check name. Confirm the check run's `app.id` in this repository before applying.
5. **`Load Smoke` is red on `main` and is not a merge gate.** Issue #90 owns the fix. If a per-PR load gate is wanted afterwards, add it as a guarded job in the `release-gate.yml` aggregator from item 1 (a new path group plus `if: needs.changes.outputs.<group> == 'true'`) rather than by requiring `smoke`. If a merge queue is ever enabled, every required workflow — `release-gate.yml` included — must also add the `merge_group` event, or required checks will never report on queued PRs.
6. **Linear history is not enforced (section 8).** Revisit only if the merge strategy changes; `required_linear_history` would block the merge commits currently used on `main`.
7. **Readiness documentation.** After the ruleset is active and both test PRs are recorded, the owner updates `docs/production-readiness-plan.md` (the `main` branch-protection status line, section 2, and the P0 work-queue item) and checks off the issue #91 acceptance criteria. Those are intentionally left untouched until enforcement is verifiable, in line with the repository's "verified, not merged" checkbox rule.

## 13. References

- Ruleset-as-code: [`.github/rulesets/main.json`](../.github/rulesets/main.json)
- Readiness context: [`docs/production-readiness-plan.md`](production-readiness-plan.md) section 2 and P0 work queue
- Issue: https://github.com/yasserfullstack-tech/whatsapp/issues/91
- GitHub docs, rulesets and required status checks: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets
- GitHub docs, troubleshooting required status checks (skipped vs pending): https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks
- GitHub REST API, create a repository ruleset: https://docs.github.com/en/rest/repos/rules
- Workflow sources read for this document: `.github/workflows/{ci,security,production-infra,backup-recovery,reporting-scale,webhook-reliability-validation,load-smoke,onboarding-load-smoke,final-regression-gate,stress-soak}.yml`
