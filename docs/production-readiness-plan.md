# Production Readiness Plan

_Last audited against `main`: 2026-09-21_

This document is the source of truth for production-readiness and product-completeness status. It deliberately separates **repository implementation** from **production verification** so merged code, closed GitHub issues, mocks, or documentation are not mistaken for launch evidence.

## Current release verdict

> **NOT CLEARED FOR PAID PRODUCTION TRAFFIC.**

The codebase has substantial production-readiness work merged, but the paid-launch gate is still open because real Meta/provider/production/legal/recovery/capacity/independent-security evidence is incomplete. The two P0 release-health blockers from the 2026-09-17 audit — the red Load Smoke workflow and unprotected `main` — are now **closed and verified**. The remaining blockers are the external-evidence items in the launch gate below.

Audited application baseline (latest runtime-affecting `main` commit at this reconciliation):

Evidence-only/documentation merges may move `main` beyond this SHA without changing the audited runtime baseline. Advance this baseline again whenever runtime-affecting code/configuration changes merge.

- Commit: [`4c0f9a4dfb777a7ae03b97ea4a08772161c06449`](https://github.com/yasserfullstack-tech/whatsapp/commit/4c0f9a4dfb777a7ae03b97ea4a08772161c06449) (squash merge of [#116](https://github.com/yasserfullstack-tech/whatsapp/pull/116)). Its tree `0730cbd629e8d583c391001657c0d006be480406` is identical to the final validated PR head `da205521cc55cb99515b979cfd597d99c6f9be9f`.
- CI: **success** — [run 35592298252](https://github.com/yasserfullstack-tech/whatsapp/actions/runs/35592298252), including unit tests, typecheck, production build, and EN/AR desktop/tablet/mobile browser E2E on the identical validated tree.
- Security: **success** — [run 35592298388](https://github.com/yasserfullstack-tech/whatsapp/actions/runs/35592298388), including dependency audit, secret scan, CodeQL, container/supply-chain controls, and tenant-isolation/API-abuse E2E on the identical validated tree.
- Load Smoke: **success** — [run 35593707473](https://github.com/yasserfullstack-tech/whatsapp/actions/runs/35593707473) on exact `main` commit `4c0f9a4` (issue [#90](https://github.com/yasserfullstack-tech/whatsapp/issues/90) closed 2026-09-20).
- Production Infra: **success** — [run 35592298284](https://github.com/yasserfullstack-tech/whatsapp/actions/runs/35592298284) on the identical validated tree, including immutable image metadata, vulnerability policy, migrations, application startup, and production-shape health smoke with the SMTP configuration.
- `main` release controls: **active** — repository ruleset `main-release-controls` (id `23732752`, `enforcement: active`) requires pull requests, blocks deletion and force-push, and enforces five status checks: `checks`, `Dependency audit`, `Secret scan`, `CodeQL`, `Tenant isolation and API abuse tests`. Applied and verified 2026-09-20; runbook and evidence in [`docs/release-controls.md`](release-controls.md) §7 and §11 (issue [#91](https://github.com/yasserfullstack-tech/whatsapp/issues/91) closed 2026-09-20).
- Readiness/issue-state alignment for this reconciliation: **0 mismatches** — [Readiness Issue Sync run 35585949037](https://github.com/yasserfullstack-tech/whatsapp/actions/runs/35585949037). External-evidence issue [#64](https://github.com/yasserfullstack-tech/whatsapp/issues/64) remains open after the Google-first SMTP migration; the closing-keyword guard/convention remains enforced under issue [#92](https://github.com/yasserfullstack-tech/whatsapp/issues/92).

---

## Status model

A task can be in more than one state at once:

- ✅ **Verified complete** — Definition of done is satisfied and the required evidence is recorded.
- 🟦 **Implemented** — repository-side code/config/tests/docs are merged, but verification/evidence remains.
- ⏳ **External evidence required** — completion depends on Meta, Stripe, production infrastructure, legal review, a real operator destination, a real restore, a pentest, or another non-Git system.
- ⚠️ **Failing / drift** — a current workflow, operational control, or tracking state is wrong and needs correction.
- ⬜ **Open** — not verified complete.

### Checkbox rule

`[x]` means **verified complete**, not merely merged and not merely “issue closed.”

For engineering tasks, verification requires implementation, automated tests, documentation where required, and relevant green CI. For production/operations/provider/legal tasks, it additionally requires real-environment evidence. If an issue was auto-closed by a merge but its own acceptance evidence is still missing, keep the readiness checkbox unchecked.

---

# What is wrong right now

## 1. ~~Current `main` is red on Load Smoke~~ — resolved 2026-09-20

**Resolved.** [Load Smoke run 35209808796](https://github.com/yasserfullstack-tech/whatsapp/actions/runs/35209808796) failed on the 2026-09-17 audited HEAD `149cc1aa...`. The defect was fixed under issue [#90](https://github.com/yasserfullstack-tech/whatsapp/issues/90) (merged via [PR #93](https://github.com/yasserfullstack-tech/whatsapp/pull/93)), and Load Smoke has been green on `main` since 2026-09-19, including the current audited HEAD `d515e58` ([run 35528830280](https://github.com/yasserfullstack-tech/whatsapp/actions/runs/35528830280)). Issue #90 is closed with its acceptance evidence recorded. `Load Smoke` remains a post-merge release-health signal, not a merge gate (see [`docs/release-controls.md`](release-controls.md) §12, item 5).

## 2. `main` is protected by an active ruleset

**Resolved 2026-09-20.** The ruleset-as-code in [`.github/rulesets/main.json`](../.github/rulesets/main.json) was applied by the repository owner as ruleset `main-release-controls` (id `23732752`, `enforcement: active`, target `branch`, `refs/heads/main`), and both test-PR verifications are recorded:

- Red case — [PR #100](https://github.com/yasserfullstack-tech/whatsapp/pull/100) added a deliberately failing unit test; the required `checks` check-run concluded `failure`, the PR reported `mergeStateStatus: BLOCKED`, and `gh pr merge` was rejected with "the base branch policy prohibits the merge". Closed without merging, branch deleted.
- Green case — [PR #96](https://github.com/yasserfullstack-tech/whatsapp/pull/96) reported all five required checks `success` (with `CodeQL` green from both the Actions job and code-scanning default setup) and merged as `b206bcc`; the merge was gated by the ruleset.

Enforced on every pull request to `main`: pull request required, five required status checks (§4 of the runbook), `strict_required_status_checks_policy` (branch must be up to date), and server-side blocks on deletion, force-push and re-creation of `main`. `bypass_actors` is empty; the only documented emergency path is a temporary ruleset change, recorded in issue [#91](https://github.com/yasserfullstack-tech/whatsapp/issues/91).

Remaining, deliberately documented gaps (runbook §12, still open on the tracking issue): path-filtered release gates (`Production Infra`, `Backup Recovery`, `Reporting Scale`) are not yet enforceable as required checks and still run after merge; `required_approving_review_count` is `0` until a second human reviewer is reliably available; there is no `CODEOWNERS` file; `Load Smoke` is a post-merge health signal, not a merge gate. At minimum, CI and Security can no longer be bypassed on `main`.

## 3. ~~Tracking issues and readiness evidence have drifted apart~~ — reconciled 2026-09-21

**Reconciled.** The 2026-09-17 audit found six readiness issues closed while their own comments/PRs still said required external evidence was outstanding. All six were reopened, and every one of the 22 tracking issues (#46–#67) has since been audited against this plan's gate checkboxes:

- **Reopened, evidence still outstanding (checkbox stays `[ ]`):** PR-003 [#48](https://github.com/yasserfullstack-tech/whatsapp/issues/48), PR-004 [#49](https://github.com/yasserfullstack-tech/whatsapp/issues/49), PR-006 [#51](https://github.com/yasserfullstack-tech/whatsapp/issues/51), PR-009 [#54](https://github.com/yasserfullstack-tech/whatsapp/issues/54), PR-010 [#55](https://github.com/yasserfullstack-tech/whatsapp/issues/55), PR-022 [#67](https://github.com/yasserfullstack-tech/whatsapp/issues/67).
- **Verified complete, legitimately closed (checkbox `[x]`):** PR-001 [#46](https://github.com/yasserfullstack-tech/whatsapp/issues/46), PR-014 [#59](https://github.com/yasserfullstack-tech/whatsapp/issues/59), PR-017 [#62](https://github.com/yasserfullstack-tech/whatsapp/issues/62).
- **Already open, stays open until its DoD and evidence are met:** the remaining unchecked items (#47, #50, #52, #53, #56, #57, #58, #60, #64, #65, #66).

The item-by-item record is in [Readiness issue-state audit (2026-09-21)](#readiness-issue-state-audit-2026-09-21). The convention that prevents recurrence is in [Closing-keyword convention for readiness PRs](#closing-keyword-convention-for-readiness-prs), and `bun infra/production/scripts/check-readiness-sync.ts` fails on any checkbox/issue-state mismatch.

**Rule (unchanged):** reopen an issue when its required evidence is genuinely outstanding, or attach/review the missing evidence before leaving it closed. Do not use issue state alone as the release gate.

## 4. Mock/local regression coverage is not provider acceptance

The repository has strong local/fake-provider regression coverage, but fake Meta, mock Stripe, local R2/S3, or synthetic email cannot close the provider-production acceptance gate. PR-012 exists specifically to require real-provider evidence.

---

# Current task status

| Task | Readiness | Repository implementation | What is still required |
| --- | --- | --- | --- |
| PR-001 Production readiness tracking | ✅ `[x]` | Merged via [#68](https://github.com/yasserfullstack-tech/whatsapp/pull/68) | Keep this plan current and keep merge gates accurate. |
| PR-002 Current Meta Embedded Signup | 🟦 ⏳ `[ ]` | v4/config-driven flow merged via [#70](https://github.com/yasserfullstack-tech/whatsapp/pull/70); retry isolation, WABA/phone binding, and final repository verification merged via [#116](https://github.com/yasserfullstack-tech/whatsapp/pull/116) | Verify current production/test Meta config ID and complete a real Meta test-business onboarding with redacted evidence in [#47](https://github.com/yasserfullstack-tech/whatsapp/issues/47). |
| PR-003 Connection health / reauthorization | 🟦 ⏳ `[ ]` | Lifecycle/validation/reconnect work merged via [#79](https://github.com/yasserfullstack-tech/whatsapp/pull/79) | Attach real staging reconnect/credential-replacement evidence to the reopened [#48](https://github.com/yasserfullstack-tech/whatsapp/issues/48). |
| PR-004 Meta asset/account synchronization | 🟦 ⏳ `[ ]` | Webhook/reconciliation/audit/metrics work merged via [#78](https://github.com/yasserfullstack-tech/whatsapp/pull/78) | Capture a real Meta state transition or reconciliation repair in staging and attach it to the reopened [#49](https://github.com/yasserfullstack-tech/whatsapp/issues/49). |
| PR-005 External Meta prerequisites | ⏳ `[ ]` | Evidence runbook merged via [#69](https://github.com/yasserfullstack-tech/whatsapp/pull/69) | Production Meta approvals/access, webhook/configuration, real WABA/phone onboarding, and sanitized proof in [#50](https://github.com/yasserfullstack-tech/whatsapp/issues/50). |
| PR-006 Real billing provider | 🟦 ⏳ `[ ]` | Stripe provider/lifecycle/webhook code merged via [#73](https://github.com/yasserfullstack-tech/whatsapp/pull/73) | Run the documented real Stripe test-mode lifecycle: Checkout, webhooks, upgrade/downgrade, portal, failed-payment recovery, cancel, replay, refund. Attach the evidence to the reopened [#51](https://github.com/yasserfullstack-tech/whatsapp/issues/51). |
| PR-007 Server-side entitlements | 🟦 ⏳ `[ ]` | Enforcement/accounting merged via [#76](https://github.com/yasserfullstack-tech/whatsapp/pull/76); repository verification recorded on [#52](https://github.com/yasserfullstack-tech/whatsapp/issues/52) | Repository enforcement/usage-accounting evidence is complete; prove real Stripe-driven plan/status transitions through the same paths with PR-006/PR-012. |
| PR-008 Legal/compliance | 🟦 ⏳ `[ ]` | Versioned drafts, acceptance storage, and runbooks merged via [#74](https://github.com/yasserfullstack-tech/whatsapp/pull/74) | Qualified legal review/approval, final entity/jurisdiction/vendor details, and approval evidence in [#53](https://github.com/yasserfullstack-tech/whatsapp/issues/53). |
| PR-009 Staging/production infrastructure | 🟦 ⏳ `[ ]` | Isolation/immutable release/evidence/rollback tooling merged via [#71](https://github.com/yasserfullstack-tech/whatsapp/pull/71); vulnerability-gated immutable GHCR release publishing via [#113](https://github.com/yasserfullstack-tech/whatsapp/pull/113) | Real staging + production deployment proof, DNS/TLS/firewall, environment isolation, email/Sentry/Meta config, and actual rollback drill — attach to the reopened [#54](https://github.com/yasserfullstack-tech/whatsapp/issues/54). |
| PR-010 Backup/recovery | 🟦 ⏳ `[ ]` | Backup scheduling, off-server validation, restore drill tooling merged via [#77](https://github.com/yasserfullstack-tech/whatsapp/pull/77) | Real production timer/backup, freshness monitoring, clean-host restore + app smoke test, measured recovery, and accepted RPO/RTO/R2 strategy — attach to the reopened [#55](https://github.com/yasserfullstack-tech/whatsapp/issues/55). |
| PR-011 Production alerting | 🟦 ⏳ `[ ]` | Alert rules, Alertmanager, exporters/probes, runbooks merged via [#75](https://github.com/yasserfullstack-tech/whatsapp/pull/75) | Trigger test alerts and prove delivery to a real human-operated destination; attach evidence to [#56](https://github.com/yasserfullstack-tech/whatsapp/issues/56). |
| PR-012 Real-provider validation | 🟦 ⏳ `[ ]` | Evidence manifest/validator/signoff tooling merged via [#87](https://github.com/yasserfullstack-tech/whatsapp/pull/87) | Execute every required real-provider flow and recovery case, validate with `--require-pass`, review/redact artifacts, attach results to [#57](https://github.com/yasserfullstack-tech/whatsapp/issues/57). |
| PR-013 Representative scale validation | 🟦 ⏳ `[ ]` | Certification/evidence controls merged via [#89](https://github.com/yasserfullstack-tech/whatsapp/pull/89) | Run representative staging/production-like load/soak/chaos/recovery on the restored green Load Smoke baseline ([#90](https://github.com/yasserfullstack-tech/whatsapp/issues/90), closed 2026-09-20) with immutable release evidence, and attach artifacts to [#58](https://github.com/yasserfullstack-tech/whatsapp/issues/58). |
| PR-014 Inbound inbox | ✅ `[x]` | Merged via [#82](https://github.com/yasserfullstack-tech/whatsapp/pull/82) | Maintain regression/provider validation under PR-012. |
| PR-015 Rich WhatsApp templates | 🟦 ⏳ `[ ]` | Rich components/preview/bindings/validation merged via [#80](https://github.com/yasserfullstack-tech/whatsapp/pull/80) | Approved representative rich template + real staging send evidence in [#60](https://github.com/yasserfullstack-tech/whatsapp/issues/60). |
| PR-016 Campaign scheduling | ✅ `[x]` | Scheduling implementation merged via [#83](https://github.com/yasserfullstack-tech/whatsapp/pull/83); final deterministic scheduling/worker verification merged via [#96](https://github.com/yasserfullstack-tech/whatsapp/pull/96) | Verified complete; [#61](https://github.com/yasserfullstack-tech/whatsapp/issues/61) closed after protected-merge and CI/Security/browser evidence review. |
| PR-017 Onboarding test mode | ✅ `[x]` | Merged and verified via [#85](https://github.com/yasserfullstack-tech/whatsapp/pull/85) | Maintain regression coverage. |
| PR-018 Contact management | ✅ `[x]` | Product surface merged via [#84](https://github.com/yasserfullstack-tech/whatsapp/pull/84); production-query/performance verification via [#105](https://github.com/yasserfullstack-tech/whatsapp/pull/105) and browser/security E2E via [#97](https://github.com/yasserfullstack-tech/whatsapp/pull/97) | Verified complete; [#63](https://github.com/yasserfullstack-tech/whatsapp/issues/63) closed after all acceptance/evidence requirements landed on protected `main`. |
| PR-019 Notification runtime | 🟦 ⏳ `[ ]` | Runtime event sources/dedupe/preferences/reconciliation merged via [#86](https://github.com/yasserfullstack-tech/whatsapp/pull/86); source mapping/replay hardening via [#103](https://github.com/yasserfullstack-tech/whatsapp/pull/103) and [#110](https://github.com/yasserfullstack-tech/whatsapp/pull/110); Google-first provider-neutral SMTP via [#114](https://github.com/yasserfullstack-tech/whatsapp/pull/114) | Repository verification and browser/security evidence are complete; attach one redacted real staging/production SMTP delivery through the application before promoting the checkbox. |
| PR-020 Platform admin tooling | 🟦 ⏳ `[ ]` | Admin tooling merged via [#81](https://github.com/yasserfullstack-tech/whatsapp/pull/81); operational/browser/security verification completed via [#98](https://github.com/yasserfullstack-tech/whatsapp/pull/98) and [#106](https://github.com/yasserfullstack-tech/whatsapp/pull/106) | Attach redacted admin-workflow evidence from a real environment before promoting the checkbox. |
| PR-021 Container/supply-chain security | 🟦 ⏳ `[ ]` | Core controls merged via [#72](https://github.com/yasserfullstack-tech/whatsapp/pull/72); continuous guard/evidence via [#102](https://github.com/yasserfullstack-tech/whatsapp/pull/102); non-root migrator hardening via [#108](https://github.com/yasserfullstack-tech/whatsapp/pull/108) | Explicit owner acceptance of the documented unfixed upstream HIGH findings through the stated review window, or replacement/remediation when a fixed base/package is available. |
| PR-022 Application security / independent testing | 🟦 ⏳ `[ ]` | IDOR/object-storage/rotation/RLS/admin hardening merged via [#88](https://github.com/yasserfullstack-tech/whatsapp/pull/88) | Independent assessment/pentest plus remediation/retest or formal acceptance of critical/high findings — attach to the reopened [#67](https://github.com/yasserfullstack-tech/whatsapp/issues/67). |

---

# Paid-production launch gate

Do **not** accept normal paid production customers until every launch blocker below is positively verified. Repository implementation alone is insufficient.

- [x] PR-001 Production readiness tracking — [#46](https://github.com/yasserfullstack-tech/whatsapp/issues/46)
- [ ] PR-002 Current Meta Embedded Signup migration — [#47](https://github.com/yasserfullstack-tech/whatsapp/issues/47)
- [ ] PR-003 Connection health and reauthorization — [#48](https://github.com/yasserfullstack-tech/whatsapp/issues/48)
- [ ] PR-004 Meta asset/account synchronization — [#49](https://github.com/yasserfullstack-tech/whatsapp/issues/49)
- [ ] PR-005 External Meta production prerequisites — [#50](https://github.com/yasserfullstack-tech/whatsapp/issues/50)
- [ ] PR-006 Real billing provider — [#51](https://github.com/yasserfullstack-tech/whatsapp/issues/51)
- [ ] PR-007 Server-side entitlement enforcement — [#52](https://github.com/yasserfullstack-tech/whatsapp/issues/52)
- [ ] PR-008 Final legal/compliance package — [#53](https://github.com/yasserfullstack-tech/whatsapp/issues/53)
- [ ] PR-009 Production infrastructure — [#54](https://github.com/yasserfullstack-tech/whatsapp/issues/54)
- [ ] PR-010 Backup/recovery proof — [#55](https://github.com/yasserfullstack-tech/whatsapp/issues/55)
- [ ] PR-011 Alerting/on-call readiness — [#56](https://github.com/yasserfullstack-tech/whatsapp/issues/56)
- [ ] PR-012 Real-provider validation — [#57](https://github.com/yasserfullstack-tech/whatsapp/issues/57)
- [ ] PR-013 Representative scale validation for any published capacity claim — [#58](https://github.com/yasserfullstack-tech/whatsapp/issues/58)

## Launch evidence still required

- [ ] Current Meta Embedded Signup config and real onboarding evidence.
- [ ] Meta production approvals/permissions/webhook/phone/WABA proof.
- [ ] Real reconnect/credential-replacement evidence.
- [ ] Real Meta asset/account state synchronization evidence.
- [ ] Real Stripe test-mode checkout/subscription/payment/recovery/replay evidence.
- [ ] Final entitlement verification linked to the billing/provider lifecycle.
- [ ] Legal/compliance approval.
- [ ] Real staging and production deployment evidence, including DNS/TLS/firewall/isolation and rollback.
- [ ] Real scheduled/off-server backup plus clean-host restore/recovery drill and accepted RPO/RTO.
- [ ] Alert delivery to a human-operated destination.
- [ ] Complete PR-012 real-provider evidence matrix.
- [ ] Representative load/soak/chaos/recovery evidence.
- [x] Current Load Smoke failure resolved and rerun green (issue [#90](https://github.com/yasserfullstack-tech/whatsapp/issues/90), green on `main` since 2026-09-19).

---

# Product-completeness / post-launch gate

These items do not necessarily block the first paid launch unless explicitly promised in launch scope, but their status must still distinguish implementation from verification.

- [x] PR-014 Inbound inbox — [#59](https://github.com/yasserfullstack-tech/whatsapp/issues/59)
- [ ] PR-015 Rich WhatsApp templates — [#60](https://github.com/yasserfullstack-tech/whatsapp/issues/60)
- [x] PR-016 Campaign scheduling/automation foundation — [#61](https://github.com/yasserfullstack-tech/whatsapp/issues/61)
- [x] PR-017 Onboarding test mode — [#62](https://github.com/yasserfullstack-tech/whatsapp/issues/62)
- [x] PR-018 Contact management depth — [#63](https://github.com/yasserfullstack-tech/whatsapp/issues/63)
- [ ] PR-019 Full notification runtime — [#64](https://github.com/yasserfullstack-tech/whatsapp/issues/64)
- [ ] PR-020 Expanded platform admin tooling — [#65](https://github.com/yasserfullstack-tech/whatsapp/issues/65)
- [ ] PR-021 Container/supply-chain hardening — [#66](https://github.com/yasserfullstack-tech/whatsapp/issues/66)
- [ ] PR-022 Application security hardening / independent testing — [#67](https://github.com/yasserfullstack-tech/whatsapp/issues/67)

---

# Immediate work queue

## P0 — release health and controls

1. ~~Investigate [Load Smoke run 35209808796](https://github.com/yasserfullstack-tech/whatsapp/actions/runs/35209808796), fix the verified cause, rerun, and require a green release-relevant load gate.~~ ✅ **Verified complete 2026-09-20** — fixed under [#90](https://github.com/yasserfullstack-tech/whatsapp/issues/90) (merged via [PR #93](https://github.com/yasserfullstack-tech/whatsapp/pull/93)); Load Smoke green on `main` since 2026-09-19 including current HEAD `d515e58` ([run 35528830280](https://github.com/yasserfullstack-tech/whatsapp/actions/runs/35528830280)). Follow-up: a per-PR load gate still needs the always-on aggregator pattern (runbook §12 item 5).
2. ~~Protect `main` (or add an equivalent ruleset) so required CI/Security/release checks cannot be bypassed.~~ ✅ **Verified complete 2026-09-20** — ruleset `main-release-controls` (id `23732752`) is active on `refs/heads/main`; red case [PR #100](https://github.com/yasserfullstack-tech/whatsapp/pull/100) was blocked, green case [PR #96](https://github.com/yasserfullstack-tech/whatsapp/pull/96) merged gated. Follow-up: convert the path-filtered release gates to an always-on aggregator so they can be required too (runbook §12 item 1).
3. ~~Reconcile incorrectly closed readiness issues with their own outstanding evidence requirements.~~ ✅ **Verified complete 2026-09-21** — all six drifted issues (#48, #49, #51, #54, #55, #67) were reopened, the #46–#67 audit is recorded below, and `bun infra/production/scripts/check-readiness-sync.ts` reports 0 mismatches.

## P0 — close paid-launch external evidence

4. Complete PR-002/003/004/005 Meta staging/production evidence.
5. Complete PR-006 Stripe test-mode lifecycle evidence and link PR-007 verification to it.
6. Obtain PR-008 legal approval.
7. Execute PR-009 production infrastructure proof and rollback drill.
8. Execute PR-010 real backup/recovery drill.
9. Prove PR-011 alert delivery to a human operator.
10. Run the full PR-012 real-provider validation session.
11. Run PR-013 representative load/soak/chaos/recovery certification.

## P1 — product/security evidence backfill

12. Complete PR-015 real rich-template staging send evidence.
13. Complete real configured email-provider delivery evidence for PR-019, the remaining real-environment admin evidence for PR-020, and the owner-reviewed vulnerability exception/release evidence for PR-021.
14. Complete PR-022 independent security assessment/pentest and remediation gate.

---

# Task acceptance details

The sections below preserve the intended acceptance criteria while focusing on what remains.

## [x] PR-001 — Production readiness tracking

**Tracking:** [#46](https://github.com/yasserfullstack-tech/whatsapp/issues/46) · **Implementation:** [#68](https://github.com/yasserfullstack-tech/whatsapp/pull/68)

Verified complete. Continue maintaining this plan and release-gate accuracy.

## [ ] PR-002 — Migrate Embedded Signup to the current Meta flow

**Tracking:** [#47](https://github.com/yasserfullstack-tech/whatsapp/issues/47) · **Implementation:** [#70](https://github.com/yasserfullstack-tech/whatsapp/pull/70) · **Repository hardening/verification:** [#116](https://github.com/yasserfullstack-tech/whatsapp/pull/116)

Repository-side v4/config-driven signup, safe callback validation, cancellation/error handling, and automated tests are merged. PR #116 additionally isolates retries by attempt generation and Meta message source, rejects stale callbacks/events, verifies the selected phone belongs to the submitted WABA before saving, and updates the fake Meta contract so protected browser E2E covers the hardened flow. The final PR head passed CI, Security, Production Infra, and the full browser matrix before protected squash merge as `4c0f9a4`; post-merge Load Smoke is green on that exact commit.

**Still needed:** current Meta configuration proof plus one real Meta test/business onboarding with sanitized evidence.

## [ ] PR-003 — WhatsApp connection health and reauthorization lifecycle

**Tracking:** [#48](https://github.com/yasserfullstack-tech/whatsapp/issues/48) · **Implementation:** [#79](https://github.com/yasserfullstack-tech/whatsapp/pull/79)

Connection health persistence, credential validation, safe send blocking, UI state, notifications, and reconnect behavior are implemented.

**Still needed:** real staging evidence that a broken/revoked credential is detected and a reconnect safely replaces/restores it without exposing token material.

## [ ] PR-004 — Meta asset and account synchronization

**Tracking:** [#49](https://github.com/yasserfullstack-tech/whatsapp/issues/49) · **Implementation:** [#78](https://github.com/yasserfullstack-tech/whatsapp/pull/78)

Template/phone/WABA state handling, idempotent durable webhooks, periodic reconciliation, audit logging, metrics, and alerts are implemented.

**Still needed:** redacted staging evidence for a real provider state transition or reconciliation repair.

## [ ] PR-005 — Complete external Meta production prerequisites

**Tracking:** [#50](https://github.com/yasserfullstack-tech/whatsapp/issues/50) · **Runbook:** [#69](https://github.com/yasserfullstack-tech/whatsapp/pull/69)

**Still needed:** app mode/status, business/provider prerequisites where required, Advanced Access/App Review state, production webhook subscription, production Embedded Signup configuration, and real WABA + phone onboarding evidence.

## [ ] PR-006 — Implement the real billing provider

**Tracking:** [#51](https://github.com/yasserfullstack-tech/whatsapp/issues/51) · **Implementation:** [#73](https://github.com/yasserfullstack-tech/whatsapp/pull/73)

Stripe customer/Checkout/subscription changes/cancellation/portal/invoice/payment/failure/refund/webhook handling is implemented with signature verification and replay-safe event processing.

**Still needed:** real Stripe test-mode end-to-end lifecycle evidence using configured test Prices and an externally reachable test webhook endpoint.

## [ ] PR-007 — Enforce entitlements and usage limits server-side

**Tracking:** [#52](https://github.com/yasserfullstack-tech/whatsapp/issues/52) · **Implementation:** [#76](https://github.com/yasserfullstack-tech/whatsapp/pull/76)

Server/worker enforcement for paid limits and idempotent usage accounting is implemented. Repository verification on #52 covers direct API/service bypass protection, duplicate/replay-safe accounting, period rollover, tenant isolation, upgrade/downgrade behavior, and the server/worker enforcement boundaries.

**Still needed:** prove the real Stripe test-mode subscription/payment lifecycle drives these same entitlement paths correctly, together with PR-006/PR-012 provider validation.

## [ ] PR-008 — Finalize legal documents and compliance procedures

**Tracking:** [#53](https://github.com/yasserfullstack-tech/whatsapp/issues/53) · **Repository work:** [#74](https://github.com/yasserfullstack-tech/whatsapp/pull/74)

Versioned review drafts, acceptance persistence, configured legal disclosures, and operational runbooks exist.

**Still needed:** qualified legal approval, final real-world entity/jurisdiction/vendor facts, and an approval record. Repository text is not legal approval.

## [ ] PR-009 — Provision and validate staging/production infrastructure

**Tracking:** [#54](https://github.com/yasserfullstack-tech/whatsapp/issues/54) · **Repository work:** [#71](https://github.com/yasserfullstack-tech/whatsapp/pull/71)

Isolation guardrails, immutable image/release manifest controls, smoke/evidence collection, and rollback tooling are merged.

**Still needed:** real isolated staging and production deployments, DNS/TLS/firewall proof, separate DB/Valkey/R2/Meta assets, production email/Sentry configuration, and an actual rollback rehearsal with smoke-test success.

## [ ] PR-010 — Activate and prove backup/recovery

**Tracking:** [#55](https://github.com/yasserfullstack-tech/whatsapp/issues/55) · **Repository work:** [#77](https://github.com/yasserfullstack-tech/whatsapp/pull/77)

Backup scheduling, encryption/off-server validation, freshness evidence, restore-drill tooling, and R2 strategy documentation are merged.

**Still needed:** actual production schedule activation, a real verified off-server backup, freshness monitoring evidence, a clean-host restore + application smoke test, measured RPO/RTO, and owner acceptance.

## [ ] PR-011 — Add actionable production alerting

**Tracking:** [#56](https://github.com/yasserfullstack-tech/whatsapp/issues/56) · **Repository work:** [#75](https://github.com/yasserfullstack-tech/whatsapp/pull/75)

Version-controlled alerts, Alertmanager routing, exporters/probes, SLOs, runbooks, and a synthetic delivery test are merged.

**Still needed:** real delivery proof to the configured human-operated on-call/ops destination.

## [ ] PR-012 — Real-provider production validation

**Tracking:** [#57](https://github.com/yasserfullstack-tech/whatsapp/issues/57) · **Evidence tooling:** [#87](https://github.com/yasserfullstack-tech/whatsapp/pull/87)

The manifest, redaction validation, `--require-pass` signoff mode, and summary generation are implemented.

**Still needed:** run every required flow against the real external systems: Meta signup/send/status/failure/inbound/opt-out/reconnect/sync, R2, email, campaign dispatch, supported export/deletion, billing lifecycle, backup/restore, and rollback. Fake-provider CI is regression coverage only.

## [ ] PR-013 — Representative load, soak, and recovery validation

**Tracking:** [#58](https://github.com/yasserfullstack-tech/whatsapp/issues/58) · **Evidence tooling:** [#89](https://github.com/yasserfullstack-tech/whatsapp/pull/89)

Representative-run certification, immutable release/config recording, threshold/report requirements, and evidence checksums are implemented.

**Still needed:** run representative infrastructure benchmarks at the workload sizes behind any product claim on the restored green Load Smoke baseline, and attach load/soak/chaos/recovery evidence. Do not infer 100k/500k production capacity from local fake-provider tests.

## [x] PR-014 — Build the inbound WhatsApp inbox

**Tracking:** [#59](https://github.com/yasserfullstack-tech/whatsapp/issues/59) · **Implementation:** [#82](https://github.com/yasserfullstack-tech/whatsapp/pull/82)

Verified complete in the plan. Real-provider message/reply behavior remains part of PR-012 launch validation.

## [ ] PR-015 — Support rich WhatsApp templates

**Tracking:** [#60](https://github.com/yasserfullstack-tech/whatsapp/issues/60) · **Implementation:** [#80](https://github.com/yasserfullstack-tech/whatsapp/pull/80)

Structural text/image/video/document headers, buttons, preview, parameter mapping, validation, and send rendering are merged for the supported families.

**Still needed:** redacted evidence for an approved representative rich template and a real staging send through Meta.

## [x] PR-016 — Campaign scheduling and automation foundation

**Tracking:** [#61](https://github.com/yasserfullstack-tech/whatsapp/issues/61) · **Implementation:** [#83](https://github.com/yasserfullstack-tech/whatsapp/pull/83) · **Final verification:** [#96](https://github.com/yasserfullstack-tech/whatsapp/pull/96)

Verified complete. Scheduling, workspace timezone handling, no-early-dispatch behavior, idempotent claims, dispatch-time audience snapshotting, cancel/reschedule, UI state, deterministic clock/timezone tests, and duplicate-execution protection are on `main`. PR #96 merged through the protected-main policy after green CI/Security/browser evidence was attached to #61; the tracking issue was closed on 2026-09-21.

## [x] PR-017 — Implement real onboarding test mode

**Tracking:** [#62](https://github.com/yasserfullstack-tech/whatsapp/issues/62) · **Implementation:** [#85](https://github.com/yasserfullstack-tech/whatsapp/pull/85)

Verified complete with server-enforced recipient limits, direct-API bypass protection, success/failure onboarding semantics, and automated/browser coverage.

## [x] PR-018 — Complete contact management

**Tracking:** [#63](https://github.com/yasserfullstack-tech/whatsapp/issues/63) · **Implementation:** [#84](https://github.com/yasserfullstack-tech/whatsapp/pull/84) · **Final verification:** [#105](https://github.com/yasserfullstack-tech/whatsapp/pull/105), [#97](https://github.com/yasserfullstack-tech/whatsapp/pull/97)

Verified complete. Manual CRUD, custom fields/tags/notes, import mapping, broader activity, bulk operations, suppression behavior, auditable merge/dedupe, permission and tenant-isolation boundaries, and keyset pagination are covered on `main`. PR #105 added production-equivalent route/integration coverage and 10,000-contact `EXPLAIN (ANALYZE)` evidence; PR #97 added direct browser/API/security evidence and merged as `1fd0dcab` after CI run 35564885943 and Security run 35564885977 passed. The tracking issue was closed on 2026-09-21.

## [ ] PR-019 — Wire the full notification catalog

**Tracking:** [#64](https://github.com/yasserfullstack-tech/whatsapp/issues/64) · **Implementation:** [#86](https://github.com/yasserfullstack-tech/whatsapp/pull/86), [#114](https://github.com/yasserfullstack-tech/whatsapp/pull/114) · **Repository verification:** [#103](https://github.com/yasserfullstack-tech/whatsapp/pull/103), [#110](https://github.com/yasserfullstack-tech/whatsapp/pull/110)

Runtime event sources, preference/mandatory-category handling, replay-safe dedupe, durable reconciliation, persistent restart-safe reconciliation cursor behavior, delayed billing-event replay, observable delivery, and a shared provider-neutral SMTP transport are merged. PR #114 removes the Resend-specific runtime/deployment requirement, uses Google/Gmail as the current SMTP configuration example, bounds SMTP connection/TLS waits, treats server acceptance after DATA as the delivery boundary, and passed CI/browser, Security, Production Infra, and Readiness Sync before protected merge.

**Still needed:** trigger one real email through the deployed staging/production application using the configured SMTP provider (Google initially), then attach redacted evidence showing SMTP acceptance, the application Message-ID/reference, and recipient or Sent-folder proof. Repository CI does not substitute for that external delivery evidence.

## [ ] PR-020 — Expand platform admin tooling

**Tracking:** [#65](https://github.com/yasserfullstack-tech/whatsapp/issues/65) · **Implementation:** [#81](https://github.com/yasserfullstack-tech/whatsapp/pull/81) · **Repository verification:** [#98](https://github.com/yasserfullstack-tech/whatsapp/pull/98), [#106](https://github.com/yasserfullstack-tech/whatsapp/pull/106)

Platform-admin access, membership support, billing/Meta visibility, safe queue retry, webhook operations, pagination/search, and audit export are merged without adding impersonation. Repository verification covers privileged authorization/audit boundaries plus real browser operational flows, including queue/dead-letter and webhook retry behavior.

**Still needed:** attach redacted admin-workflow evidence from a real staging/production-like environment. Repository CI/browser evidence does not substitute for that external operational proof.

## [ ] PR-021 — Container and supply-chain security hardening

**Tracking:** [#66](https://github.com/yasserfullstack-tech/whatsapp/issues/66) · **Implementation:** [#72](https://github.com/yasserfullstack-tech/whatsapp/pull/72) · **Continuous verification:** [#102](https://github.com/yasserfullstack-tech/whatsapp/pull/102), [#108](https://github.com/yasserfullstack-tech/whatsapp/pull/108)

Frozen Bun installs, OCI source/revision/version labels, Trivy scanning, report artifacts, HIGH/CRITICAL blocking policy, continuous policy-drift checks, and non-root production/migrator execution are merged and green. No finding is suppressed and the severity policy was not weakened.

**Still needed:** the owner must explicitly accept the documented unfixed upstream HIGH findings for the stated review window (currently through 2026-10-20), or replace/remediate the affected base/package once a fix is available. Record that decision/rationale on #66 and keep the continuous scans green.

## [ ] PR-022 — Application security hardening and independent testing

**Tracking:** [#67](https://github.com/yasserfullstack-tech/whatsapp/issues/67) · **Implementation:** [#88](https://github.com/yasserfullstack-tech/whatsapp/pull/88)

Expanded IDOR/object-storage tests, credential key-rotation exercise/design, RLS decision, and privileged-admin review are merged. Current audited HEAD has green CI, Security, and Production Infra.

**Still needed:** independent security review/pentest for the required release stage, plus remediation/retest or formal acceptance of critical/high findings. The tracking issue was reopened on 2026-09-21 because this evidence remains outstanding.

---

# Completion discipline

Before changing any unchecked task to `[x]`:

1. Confirm every Definition-of-done condition is actually satisfied.
2. Link the exact implementation PR/commit.
3. Link the relevant green CI/Security/specialized workflow runs.
4. For external/production tasks, attach sanitized real-environment evidence to the tracking issue.
5. Confirm the issue state matches the evidence state; reopen an accidentally auto-closed issue if required evidence is missing.
6. Update this plan in the same change that declares the task verified.

A green local/fake-provider test is valuable regression evidence, but it does not substitute for provider, production, legal, recovery, operator-delivery, representative-capacity, or independent-security evidence where those are explicitly required.

---

# Closing-keyword convention for readiness PRs

The readiness tracking issues (#46–#67) are the source of truth for launch state; this plan's top-level `[x]`/`[ ]` checkboxes must stay aligned with them. To stop the drift documented in [#92](https://github.com/yasserfullstack-tech/whatsapp/issues/92), use these merge keywords on readiness implementation PRs:

- `[x]` in this plan means **verified complete**, not merely merged. Never check a box (and never declare a task done) until its Definition of Done and any required real-environment evidence are satisfied.
- An implementation PR that intentionally leaves external evidence outstanding **must** use `Refs #N` or `Supports #N`, **never** `Closes #N` or `Fixes #N`. This applies to provider, production, legal, recovery, capacity, operator-delivery, and independent-security evidence that cannot be produced by repository CI.
- Do not put a negated closing phrase next to a readiness issue reference either (for example, `does not close #N`). GitHub can still parse the embedded `close #N` token when the PR merges. Write `keeps #N open` instead.
- External-evidence tracking issues are **never** closed by repository CI alone. A merge that auto-closes one of #46–#67 must first carry real evidence of completion, or the issue must be reopened and the plan checkbox left unchecked.
- When a readiness checkbox is promoted to `[x]`, the same change/review must confirm the tracking issue can be closed and that evidence links are present on the issue.
- If a tracking issue was auto-closed by a merge while evidence is still outstanding, reopen it and keep the corresponding plan checkbox unchecked.

A minimal automated check enforces this contract:

```
bun infra/production/scripts/check-readiness-sync.ts
```

It parses the top-level `PR-001`..`PR-022` checklist in this file, queries each tracking issue's state, and fails when a checked item has an open issue or an unchecked item has a closed issue.

The convention is enforced at the moment drift is most likely to be introduced:

- The check runs on every push to `main` and every PR that touches this plan (`.github/workflows/readiness-sync.yml`).
- It **also** runs on the `issues: [closed, reopened]` events. If an implementation PR's merge keyword auto-closes one of #46–#67 while the plan checkbox is still `[ ]`, the `Readiness Issue Sync` run turns red and annotates the drift, so a repository-CI-only closure cannot pass unnoticed.
- The same convention is surfaced to every PR author in [`.github/pull_request_template.md`](../.github/pull_request_template.md), so the `Refs`/`Supports` rule is visible where the merge keyword is actually written.

---

# Readiness issue-state audit (2026-09-21)

Performed for [#92](https://github.com/yasserfullstack-tech/whatsapp/issues/92). `bun infra/production/scripts/check-readiness-sync.ts` audits all 22 tracking issues (#46–#67) against the gate checkboxes. The 2026-09-21 reconciliation now includes verified completion of PR-016 and PR-018 and should report **0 mismatches**: every unchecked item has an open issue, and every checked item's issue is closed only with evidence supporting its Definition of Done.

| Item | Checkbox | Issue | Issue state | Verdict |
| --- | --- | --- | --- | --- |
| PR-001 | `[x]` | [#46](https://github.com/yasserfullstack-tech/whatsapp/issues/46) | CLOSED | OK — tracking task; verified CI/E2E baseline recorded on the issue, plan links all #46–#67 |
| PR-002 | `[ ]` | [#47](https://github.com/yasserfullstack-tech/whatsapp/issues/47) | OPEN | OK — repository hardening/verification merged via #116; real Meta configuration/onboarding evidence outstanding |
| PR-003 | `[ ]` | [#48](https://github.com/yasserfullstack-tech/whatsapp/issues/48) | OPEN | OK — **reopened**; real staging reconnect evidence outstanding |
| PR-004 | `[ ]` | [#49](https://github.com/yasserfullstack-tech/whatsapp/issues/49) | OPEN | OK — **reopened**; real Meta state-transition evidence outstanding |
| PR-005 | `[ ]` | [#50](https://github.com/yasserfullstack-tech/whatsapp/issues/50) | OPEN | OK — external Meta approvals/onboarding evidence outstanding |
| PR-006 | `[ ]` | [#51](https://github.com/yasserfullstack-tech/whatsapp/issues/51) | OPEN | OK — **reopened**; real Stripe test-mode lifecycle evidence outstanding |
| PR-007 | `[ ]` | [#52](https://github.com/yasserfullstack-tech/whatsapp/issues/52) | OPEN | OK — repository enforcement/accounting verification complete; real Stripe-driven plan/status transition evidence outstanding with PR-006/PR-012 |
| PR-008 | `[ ]` | [#53](https://github.com/yasserfullstack-tech/whatsapp/issues/53) | OPEN | OK — qualified legal approval outstanding |
| PR-009 | `[ ]` | [#54](https://github.com/yasserfullstack-tech/whatsapp/issues/54) | OPEN | OK — **reopened**; real staging/production deployment evidence outstanding |
| PR-010 | `[ ]` | [#55](https://github.com/yasserfullstack-tech/whatsapp/issues/55) | OPEN | OK — **reopened**; real backup/clean-host restore evidence outstanding |
| PR-011 | `[ ]` | [#56](https://github.com/yasserfullstack-tech/whatsapp/issues/56) | OPEN | OK — real operator alert-delivery proof outstanding |
| PR-012 | `[ ]` | [#57](https://github.com/yasserfullstack-tech/whatsapp/issues/57) | OPEN | OK — full real-provider evidence matrix outstanding |
| PR-013 | `[ ]` | [#58](https://github.com/yasserfullstack-tech/whatsapp/issues/58) | OPEN | OK — representative load/soak/chaos/recovery evidence outstanding |
| PR-014 | `[x]` | [#59](https://github.com/yasserfullstack-tech/whatsapp/issues/59) | CLOSED | OK — merged via [#82](https://github.com/yasserfullstack-tech/whatsapp/pull/82) with tenant-isolation/replay tests; provider send/reply evidence explicitly carried by PR-012 [#57](https://github.com/yasserfullstack-tech/whatsapp/issues/57) |
| PR-015 | `[ ]` | [#60](https://github.com/yasserfullstack-tech/whatsapp/issues/60) | OPEN | OK — real rich-template staging send evidence outstanding |
| PR-016 | `[x]` | [#61](https://github.com/yasserfullstack-tech/whatsapp/issues/61) | CLOSED | OK — final deterministic scheduling/worker coverage merged via #96; protected merge plus CI/Security/browser evidence reviewed |
| PR-017 | `[x]` | [#62](https://github.com/yasserfullstack-tech/whatsapp/issues/62) | CLOSED | OK — merged via [#85](https://github.com/yasserfullstack-tech/whatsapp/pull/85) with server-enforced limits, bypass protection and automated/browser coverage |
| PR-018 | `[x]` | [#63](https://github.com/yasserfullstack-tech/whatsapp/issues/63) | CLOSED | OK — #105 production-query/performance evidence plus #97 browser/security E2E merged and reviewed |
| PR-019 | `[ ]` | [#64](https://github.com/yasserfullstack-tech/whatsapp/issues/64) | OPEN | OK — repository/browser/security verification complete; redacted real configured email-provider staging/production delivery evidence outstanding |
| PR-020 | `[ ]` | [#65](https://github.com/yasserfullstack-tech/whatsapp/issues/65) | OPEN | OK — repository authorization/browser/operational verification complete; redacted real-environment admin-workflow evidence outstanding |
| PR-021 | `[ ]` | [#66](https://github.com/yasserfullstack-tech/whatsapp/issues/66) | OPEN | OK — continuous scan/policy/non-root verification complete; explicit owner acceptance of documented unfixed upstream HIGH findings or upstream remediation outstanding |
| PR-022 | `[ ]` | [#67](https://github.com/yasserfullstack-tech/whatsapp/issues/67) | OPEN | OK — **reopened**; independent security assessment/pentest outstanding |

Reopened 2026-09-21 (checkbox correctly `[ ]`, evidence still outstanding): [#48](https://github.com/yasserfullstack-tech/whatsapp/issues/48), [#49](https://github.com/yasserfullstack-tech/whatsapp/issues/49), [#51](https://github.com/yasserfullstack-tech/whatsapp/issues/51), [#54](https://github.com/yasserfullstack-tech/whatsapp/issues/54), [#55](https://github.com/yasserfullstack-tech/whatsapp/issues/55), [#67](https://github.com/yasserfullstack-tech/whatsapp/issues/67). No checked item lacks closure evidence; no unchecked item is closed.

---

# Release review step

This step is performed before declaring production readiness (or any paid-production launch) and is gated on the `release-review` workflow (manual dispatch from the Actions tab) plus a maintainer sign-off on this plan.

1. Run the consistency check and confirm zero mismatches:
   ```
   bun infra/production/scripts/check-readiness-sync.ts
   ```
   The table it prints (`item -> checkbox state -> issue number -> issue state -> OK/MISMATCH`) must contain no `MISMATCH` rows.
2. Reconcile `docs/production-readiness-plan.md` with issue state: every unchecked item must have an open tracking issue; every checked item's issue must be closed only after real evidence is attached.
3. Confirm every Paid-production launch gate (#46–#58) has verified real-environment evidence, not repository CI alone.
4. Confirm `main` branch protection and its **enforced** required checks are active — ruleset `main-release-controls` (id `23732752`) requires pull requests plus the five checks `checks`, `Dependency audit`, `Secret scan`, `CodeQL`, `Tenant isolation and API abuse tests`. Issue [#91](https://github.com/yasserfullstack-tech/whatsapp/issues/91) is evidence **only** for those controls (closed 2026-09-20; red case [PR #100](https://github.com/yasserfullstack-tech/whatsapp/pull/100), green case [PR #96](https://github.com/yasserfullstack-tech/whatsapp/pull/96)).
5. Separately confirm the gates #91 does **not** cover, because they are path-filtered and still run after merge rather than being enforceable required checks (runbook §12): `Production Infra`, `Backup Recovery`, `Reporting Scale`, and the representative load gate. Each must have its own green run on the release commit; a closed #91 must not be cited as proof for them.
6. Confirm the current Load Smoke workflow is green on the release commit — tracking issue [#90](https://github.com/yasserfullstack-tech/whatsapp/issues/90) (closed 2026-09-20, green on `main` since 2026-09-19). Note this is a post-merge health signal, not a merge gate.
7. Record the audit result and release-verdict evidence in `docs/production-readiness-plan.md` under "Current release verdict" before announcing readiness.
