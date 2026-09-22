# Production Readiness Plan

_Last reconciled against `main`: 2026-09-22_

This document is the source of truth for production-readiness and product-completeness status. It separates **repository implementation issue disposition** from **production verification**. A closed implementation issue means the repository-side scope is complete or explicitly deferred/not planned; it does **not** by itself mean the product is cleared for paid production.

## Current release verdict

> **NOT CLEARED FOR PAID PRODUCTION TRAFFIC.**

All repository implementation tracking issues (#46–#67) are now closed under the code-completion policy, but the paid-launch gate is still open because real Meta/provider/production/legal/recovery/capacity/independent-security evidence is incomplete. Issue closure is not proof of launch readiness; the separate launch-evidence checklist below is authoritative for that decision.

Last fully evidenced runtime baseline retained from the prior audit:

The repository has moved beyond this SHA, including later provider-neutral billing changes. Refresh this evidence block against the intended release commit before paid-production approval.

- Commit: [`4c0f9a4dfb777a7ae03b97ea4a08772161c06449`](https://github.com/yasserfullstack-tech/whatsapp/commit/4c0f9a4dfb777a7ae03b97ea4a08772161c06449) (squash merge of [#116](https://github.com/yasserfullstack-tech/whatsapp/pull/116)). Its tree `0730cbd629e8d583c391001657c0d006be480406` is identical to the final validated PR head `da205521cc55cb99515b979cfd597d99c6f9be9f`.
- CI: **success** — [run 35593707367](https://github.com/yasserfullstack-tech/whatsapp/actions/runs/35593707367) on exact `main` commit `4c0f9a4`, including unit tests, typecheck, production build, and EN/AR desktop/tablet/mobile browser E2E.
- Security: **success** — [run 35593707375](https://github.com/yasserfullstack-tech/whatsapp/actions/runs/35593707375) on exact `main` commit `4c0f9a4`, including dependency audit, secret scan, CodeQL, container/supply-chain controls, and tenant-isolation/API-abuse E2E.
- Load Smoke: **success** — [run 35593707473](https://github.com/yasserfullstack-tech/whatsapp/actions/runs/35593707473) on exact `main` commit `4c0f9a4` (issue [#90](https://github.com/yasserfullstack-tech/whatsapp/issues/90) closed 2026-09-20).
- Production Infra: **success** — [run 35593707389](https://github.com/yasserfullstack-tech/whatsapp/actions/runs/35593707389) on exact `main` commit `4c0f9a4`, including immutable image metadata, vulnerability policy, migrations, application startup, and production-shape health smoke with the SMTP configuration.
- `main` release controls: **active** — repository ruleset `main-release-controls` (id `23732752`, `enforcement: active`) requires pull requests, blocks deletion and force-push, and enforces five status checks: `checks`, `Dependency audit`, `Secret scan`, `CodeQL`, `Tenant isolation and API abuse tests`. Applied and verified 2026-09-20; runbook and evidence in [`docs/release-controls.md`](release-controls.md) §7 and §11 (issue [#91](https://github.com/yasserfullstack-tech/whatsapp/issues/91) closed 2026-09-20).
- Implementation issue-state alignment: **all #46–#67 are closed**. #51 is closed as **not planned** until a production billing provider is selected, and #92 is closed after adopting the code-only issue-closure policy. External launch evidence remains tracked in this plan.

---

## Status model

Implementation issue state and launch-readiness state are intentionally separate:

- ✅ **Implementation issue closed** — repository-side implementation/config/tests/docs are complete, or the item is explicitly deferred/not planned for the current code milestone.
- 🟦 **Implemented** — repository-side work exists and is merged.
- ⏳ **Launch evidence required** — real Meta/provider/production/legal/recovery/operator/capacity/security evidence is still outstanding.
- ⚠️ **Failing / drift** — implementation checkbox and GitHub issue state disagree, or a current workflow/control is broken.

### Checkbox rule

For the `PR-001`..`PR-022` implementation checklist, `[x]` means the corresponding implementation tracking issue is closed. It does **not** mean the paid-production launch gate is satisfied.

Real-environment/provider/legal/recovery/capacity/security evidence is tracked independently in **Launch evidence still required** and the release-review section.

---

# What is wrong right now

## 1. ~~Current `main` is red on Load Smoke~~ — resolved 2026-09-20

**Resolved.** [Load Smoke run 35209808796](https://github.com/yasserfullstack-tech/whatsapp/actions/runs/35209808796) failed on the 2026-09-17 audited HEAD `149cc1aa...`. The defect was fixed under issue [#90](https://github.com/yasserfullstack-tech/whatsapp/issues/90) (merged via [PR #93](https://github.com/yasserfullstack-tech/whatsapp/pull/93)), and Load Smoke has been green on `main` since 2026-09-19, including the current audited HEAD `d515e58` ([run 35528830280](https://github.com/yasserfullstack-tech/whatsapp/actions/runs/35528830280)). Issue #90 is closed with its acceptance evidence recorded. `Load Smoke` remains a post-merge release-health signal, not a merge gate (see [`docs/release-controls.md`](release-controls.md) §12, item 5).

## 2. `main` is protected by an active ruleset

**Resolved 2026-09-20.** The ruleset-as-code in [`.github/rulesets/main.json`](../.github/rulesets/main.json) was applied by the repository owner as ruleset `main-release-controls` (id `23732752`, `enforcement: active`, target `branch`, `refs/heads/main`), and both test-PR verifications are recorded:

- Red case — [PR #100](https://github.com/yasserfullstack-tech/whatsapp/pull/100) added a deliberately failing unit test; the required `checks` check-run concluded `failure`, the PR reported `mergeStateStatus: BLOCKED`, and `gh pr merge` was rejected with "the base branch policy prohibits the merge". Closed without merging, branch deleted.
- Green case — [PR #96](https://github.com/yasserfullstack-tech/whatsapp/pull/96) reported all five required checks `success` (with `CodeQL` green from both the Actions job and code-scanning default setup) and merged as `b206bcc`; the merge was gated by the ruleset.

Enforced on every pull request to `main`: pull request required, five required status checks (§4 of the runbook), `strict_required_status_checks_policy` (branch must be up to date), and server-side blocks on deletion, force-push and re-creation of `main`. `bypass_actors` is empty; the only documented emergency path is a temporary ruleset change, recorded in issue [#91](https://github.com/yasserfullstack-tech/whatsapp/issues/91).

Remaining gaps, deliberately documented (runbook §12): `required_approving_review_count` is `0` until a second human reviewer is reliably available; `CODEOWNERS` exists (merged via [PR #126](https://github.com/yasserfullstack-tech/whatsapp/pull/126)) but `require_code_owner_review` is deliberately still `false`; `Load Smoke` is a post-merge health signal, not a merge gate. Closed 2026-09-22: the path-filtered release gates (`Production Infra`, `Backup Recovery`, `Reporting Scale`) are now enforceable through the always-on `release-gate` aggregator, which the ruleset requires as a sixth context ([PR #127](https://github.com/yasserfullstack-tech/whatsapp/pull/127); red case [PR #128](https://github.com/yasserfullstack-tech/whatsapp/pull/128) blocked). At minimum, CI and Security can no longer be bypassed on `main`.

## 3. Tracking issues now represent repository implementation only — policy updated 2026-09-22

**Reconciled.** All implementation tracking issues #46–#67 are closed. The implementation checklist mirrors those issue states, while production/provider/legal/recovery/capacity/security evidence is tracked separately and can remain outstanding after issue closure.

- PR-006 [#51](https://github.com/yasserfullstack-tech/whatsapp/issues/51) is closed as **not planned** for the current code milestone because no replacement billing provider has been selected. Provider selection and implementation remain paid-launch requirements.
- [#92](https://github.com/yasserfullstack-tech/whatsapp/issues/92) is closed because its old “unchecked issue must remain open” convention is superseded by this policy.
- `bun infra/production/scripts/check-readiness-sync.ts` is now only an implementation-checklist/issue-state consistency check; it is **not** a production-readiness verdict.

**Rule:** issue closure records code/repository disposition. Launch clearance requires the independent evidence checklist and release review below.

## 4. Mock/local regression coverage is not provider acceptance

The repository has strong local/fake-provider regression coverage, but fake Meta, a mock billing provider, local R2/S3, or synthetic email cannot close the provider-production acceptance gate. PR-012 exists specifically to require real-provider evidence.

---

# Current task status

| Task | Implementation issue | Repository implementation | What is still required before launch/verification |
| --- | --- | --- | --- |
| PR-001 Production readiness tracking | ✅ `[x]` | Merged via [#68](https://github.com/yasserfullstack-tech/whatsapp/pull/68) | Keep this plan current and keep merge gates accurate. |
| PR-002 Current Meta Embedded Signup | ✅ `[x]` | v4/config-driven flow merged via [#70](https://github.com/yasserfullstack-tech/whatsapp/pull/70); retry isolation, WABA/phone binding, and final repository verification merged via [#116](https://github.com/yasserfullstack-tech/whatsapp/pull/116) | Verify current production/test Meta config ID and complete a real Meta test-business onboarding with redacted evidence in [#47](https://github.com/yasserfullstack-tech/whatsapp/issues/47). |
| PR-003 Connection health / reauthorization | ✅ `[x]` | Lifecycle/validation/reconnect work merged via [#79](https://github.com/yasserfullstack-tech/whatsapp/pull/79) | Capture real staging reconnect/credential-replacement evidence; #48 remains closed as an implementation issue. |
| PR-004 Meta asset/account synchronization | ✅ `[x]` | Webhook/reconciliation/audit/metrics work merged via [#78](https://github.com/yasserfullstack-tech/whatsapp/pull/78) | Capture a real Meta state transition or reconciliation repair in staging and record it as launch evidence; #49 remains closed as an implementation issue. |
| PR-005 External Meta prerequisites | ✅ `[x]` | Evidence runbook merged via [#69](https://github.com/yasserfullstack-tech/whatsapp/pull/69) | Production Meta approvals/access, webhook/configuration, real WABA/phone onboarding, and sanitized proof in [#50](https://github.com/yasserfullstack-tech/whatsapp/issues/50). |
| PR-006 Real billing provider | ✅ deferred `[x]` | Provider-neutral billing contract and local billing model remain; the previous concrete provider integration has been removed while a replacement is selected. | Select the production billing provider, implement it behind the provider contract, and run the documented sandbox/test lifecycle: checkout, webhooks, upgrade/downgrade, account management, failed-payment recovery, cancellation, replay, and refund behavior as supported. Record the provider evidence in the release evidence set; #51 remains closed as not planned until provider selection is resumed. |
| PR-007 Server-side entitlements | ✅ `[x]` | Enforcement/accounting merged via [#76](https://github.com/yasserfullstack-tech/whatsapp/pull/76); repository verification recorded on [#52](https://github.com/yasserfullstack-tech/whatsapp/issues/52) | Repository enforcement/usage-accounting evidence is complete; after PR-006 selects a provider, prove real provider-driven plan/status transitions through the same paths with PR-006/PR-012. |
| PR-008 Legal/compliance | ✅ `[x]` | Versioned drafts, acceptance storage, and runbooks merged via [#74](https://github.com/yasserfullstack-tech/whatsapp/pull/74) | Qualified legal review/approval, final entity/jurisdiction/vendor details, and approval evidence in the release evidence set; #53 remains closed as an implementation issue. |
| PR-009 Staging/production infrastructure | ✅ `[x]` | Isolation/immutable release/evidence/rollback tooling merged via [#71](https://github.com/yasserfullstack-tech/whatsapp/pull/71); vulnerability-gated immutable GHCR release publishing via [#113](https://github.com/yasserfullstack-tech/whatsapp/pull/113) | Real staging + production deployment proof, DNS/TLS/firewall, environment isolation, email/Sentry/Meta config, and actual rollback drill — record as launch evidence; #54 remains closed as an implementation issue. |
| PR-010 Backup/recovery | ✅ `[x]` | Backup scheduling, off-server validation, restore drill tooling merged via [#77](https://github.com/yasserfullstack-tech/whatsapp/pull/77) | Real production timer/backup, freshness monitoring, clean-host restore + app smoke test, measured recovery, and accepted RPO/RTO/R2 strategy — record as launch evidence; #55 remains closed as an implementation issue. |
| PR-011 Production alerting | ✅ `[x]` | Alert rules, Alertmanager, exporters/probes, runbooks merged via [#75](https://github.com/yasserfullstack-tech/whatsapp/pull/75) | Trigger test alerts and prove delivery to a real human-operated destination; record the delivery proof in the release evidence set; #56 remains closed as an implementation issue. |
| PR-012 Real-provider validation | ✅ `[x]` | Evidence manifest/validator/signoff tooling merged via [#87](https://github.com/yasserfullstack-tech/whatsapp/pull/87) | Execute every required real-provider flow and recovery case, validate with `--require-pass`, review/redact artifacts, record the validated results in the release evidence set; #57 remains closed as an implementation issue. |
| PR-013 Representative scale validation | ✅ `[x]` | Certification/evidence controls merged via [#89](https://github.com/yasserfullstack-tech/whatsapp/pull/89) | Run representative staging/production-like load/soak/chaos/recovery on the restored green Load Smoke baseline ([#90](https://github.com/yasserfullstack-tech/whatsapp/issues/90), closed 2026-09-20) with immutable release evidence, and record the artifacts in the release evidence set; #58 remains closed as an implementation issue. |
| PR-014 Inbound inbox | ✅ `[x]` | Merged via [#82](https://github.com/yasserfullstack-tech/whatsapp/pull/82) | Maintain regression/provider validation under PR-012. |
| PR-015 Rich WhatsApp templates | ✅ `[x]` | Rich components/preview/bindings/validation merged via [#80](https://github.com/yasserfullstack-tech/whatsapp/pull/80) | Approved representative rich template + real staging send evidence in [#60](https://github.com/yasserfullstack-tech/whatsapp/issues/60). |
| PR-016 Campaign scheduling | ✅ `[x]` | Scheduling implementation merged via [#83](https://github.com/yasserfullstack-tech/whatsapp/pull/83); final deterministic scheduling/worker verification merged via [#96](https://github.com/yasserfullstack-tech/whatsapp/pull/96) | Verified complete; [#61](https://github.com/yasserfullstack-tech/whatsapp/issues/61) closed after protected-merge and CI/Security/browser evidence review. |
| PR-017 Onboarding test mode | ✅ `[x]` | Merged and verified via [#85](https://github.com/yasserfullstack-tech/whatsapp/pull/85) | Maintain regression coverage. |
| PR-018 Contact management | ✅ `[x]` | Product surface merged via [#84](https://github.com/yasserfullstack-tech/whatsapp/pull/84); production-query/performance verification via [#105](https://github.com/yasserfullstack-tech/whatsapp/pull/105) and browser/security E2E via [#97](https://github.com/yasserfullstack-tech/whatsapp/pull/97) | Verified complete; [#63](https://github.com/yasserfullstack-tech/whatsapp/issues/63) closed after all acceptance/evidence requirements landed on protected `main`. |
| PR-019 Notification runtime | ✅ `[x]` | Runtime event sources/dedupe/preferences/reconciliation merged via [#86](https://github.com/yasserfullstack-tech/whatsapp/pull/86); source mapping/replay hardening via [#103](https://github.com/yasserfullstack-tech/whatsapp/pull/103) and [#110](https://github.com/yasserfullstack-tech/whatsapp/pull/110); Google-first provider-neutral SMTP via [#114](https://github.com/yasserfullstack-tech/whatsapp/pull/114) | Repository verification and browser/security evidence are complete; attach one redacted real staging/production SMTP delivery through the application before paid-production approval. |
| PR-020 Platform admin tooling | ✅ `[x]` | Admin tooling merged via [#81](https://github.com/yasserfullstack-tech/whatsapp/pull/81); operational/browser/security verification completed via [#98](https://github.com/yasserfullstack-tech/whatsapp/pull/98) and [#106](https://github.com/yasserfullstack-tech/whatsapp/pull/106) | Attach redacted admin-workflow evidence from a real environment before paid-production approval. |
| PR-021 Container/supply-chain security | ✅ `[x]` | Core controls merged via [#72](https://github.com/yasserfullstack-tech/whatsapp/pull/72); continuous guard/evidence via [#102](https://github.com/yasserfullstack-tech/whatsapp/pull/102); non-root migrator hardening via [#108](https://github.com/yasserfullstack-tech/whatsapp/pull/108) | Explicit owner acceptance of the documented unfixed upstream HIGH findings through the stated review window, or replacement/remediation when a fixed base/package is available. |
| PR-022 Application security / independent testing | ✅ `[x]` | IDOR/object-storage/rotation/RLS/admin hardening merged via [#88](https://github.com/yasserfullstack-tech/whatsapp/pull/88) | Independent assessment/pentest plus remediation/retest or formal acceptance of critical/high findings — record as release evidence; #67 remains closed as an implementation issue. |

---

# Repository implementation issue disposition

These checkboxes mirror repository implementation issue disposition for #46–#58. They are all closed under the code-completion policy. They do **not** clear paid production; the separate launch-evidence checklist immediately below remains the launch gate.

- [x] PR-001 Production readiness tracking — [#46](https://github.com/yasserfullstack-tech/whatsapp/issues/46)
- [x] PR-002 Current Meta Embedded Signup migration — [#47](https://github.com/yasserfullstack-tech/whatsapp/issues/47)
- [x] PR-003 Connection health and reauthorization — [#48](https://github.com/yasserfullstack-tech/whatsapp/issues/48)
- [x] PR-004 Meta asset/account synchronization — [#49](https://github.com/yasserfullstack-tech/whatsapp/issues/49)
- [x] PR-005 External Meta production prerequisites — [#50](https://github.com/yasserfullstack-tech/whatsapp/issues/50)
- [x] PR-006 Real billing provider — [#51](https://github.com/yasserfullstack-tech/whatsapp/issues/51)
- [x] PR-007 Server-side entitlement enforcement — [#52](https://github.com/yasserfullstack-tech/whatsapp/issues/52)
- [x] PR-008 Final legal/compliance package — [#53](https://github.com/yasserfullstack-tech/whatsapp/issues/53)
- [x] PR-009 Production infrastructure — [#54](https://github.com/yasserfullstack-tech/whatsapp/issues/54)
- [x] PR-010 Backup/recovery proof — [#55](https://github.com/yasserfullstack-tech/whatsapp/issues/55)
- [x] PR-011 Alerting/on-call readiness — [#56](https://github.com/yasserfullstack-tech/whatsapp/issues/56)
- [x] PR-012 Real-provider validation — [#57](https://github.com/yasserfullstack-tech/whatsapp/issues/57)
- [x] PR-013 Representative scale validation for any published capacity claim — [#58](https://github.com/yasserfullstack-tech/whatsapp/issues/58)

## Launch evidence still required

- [ ] Current Meta Embedded Signup config and real onboarding evidence.
- [ ] Meta production approvals/permissions/webhook/phone/WABA proof.
- [ ] Real reconnect/credential-replacement evidence.
- [ ] Real Meta asset/account state synchronization evidence.
- [ ] Select the production billing provider and capture real sandbox/test checkout/subscription/payment/recovery/replay evidence.
- [ ] Final entitlement verification linked to the billing/provider lifecycle.
- [ ] Legal/compliance approval.
- [ ] Real staging and production deployment evidence, including DNS/TLS/firewall/isolation and rollback.
- [ ] Real scheduled/off-server backup plus clean-host restore/recovery drill and accepted RPO/RTO.
- [ ] Alert delivery to a human-operated destination.
- [ ] Complete PR-012 real-provider evidence matrix.
- [ ] Representative load/soak/chaos/recovery evidence.
- [x] Current Load Smoke failure resolved and rerun green (issue [#90](https://github.com/yasserfullstack-tech/whatsapp/issues/90), green on `main` since 2026-09-19).

---

# Product implementation issue disposition

These checkboxes mirror product/security implementation issue disposition for #59–#67. External verification may still remain and is recorded separately.

- [x] PR-014 Inbound inbox — [#59](https://github.com/yasserfullstack-tech/whatsapp/issues/59)
- [x] PR-015 Rich WhatsApp templates — [#60](https://github.com/yasserfullstack-tech/whatsapp/issues/60)
- [x] PR-016 Campaign scheduling/automation foundation — [#61](https://github.com/yasserfullstack-tech/whatsapp/issues/61)
- [x] PR-017 Onboarding test mode — [#62](https://github.com/yasserfullstack-tech/whatsapp/issues/62)
- [x] PR-018 Contact management depth — [#63](https://github.com/yasserfullstack-tech/whatsapp/issues/63)
- [x] PR-019 Full notification runtime — [#64](https://github.com/yasserfullstack-tech/whatsapp/issues/64)
- [x] PR-020 Expanded platform admin tooling — [#65](https://github.com/yasserfullstack-tech/whatsapp/issues/65)
- [x] PR-021 Container/supply-chain hardening — [#66](https://github.com/yasserfullstack-tech/whatsapp/issues/66)
- [x] PR-022 Application security hardening / independent testing — [#67](https://github.com/yasserfullstack-tech/whatsapp/issues/67)

---

# Immediate work queue

## P0 — release health and controls

1. ~~Investigate [Load Smoke run 35209808796](https://github.com/yasserfullstack-tech/whatsapp/actions/runs/35209808796), fix the verified cause, rerun, and require a green release-relevant load gate.~~ ✅ **Verified complete 2026-09-20** — fixed under [#90](https://github.com/yasserfullstack-tech/whatsapp/issues/90) (merged via [PR #93](https://github.com/yasserfullstack-tech/whatsapp/pull/93)); Load Smoke green on `main` since 2026-09-19 including current HEAD `d515e58` ([run 35528830280](https://github.com/yasserfullstack-tech/whatsapp/actions/runs/35528830280)). Follow-up: a per-PR load gate still needs the always-on aggregator pattern (runbook §12 item 5).
2. ~~Protect `main` (or add an equivalent ruleset) so required CI/Security/release checks cannot be bypassed.~~ ✅ **Verified complete 2026-09-20** — ruleset `main-release-controls` (id `23732752`) is active on `refs/heads/main`; red case [PR #100](https://github.com/yasserfullstack-tech/whatsapp/pull/100) was blocked, green case [PR #96](https://github.com/yasserfullstack-tech/whatsapp/pull/96) merged gated. Follow-up: ~~convert the path-filtered release gates to an always-on aggregator so they can be required too (runbook §12 item 1).~~ ✅ **Verified complete 2026-09-22** — `.github/workflows/release-gate.yml` merged via [PR #125](https://github.com/yasserfullstack-tech/whatsapp/pull/125) and `release-gate` added to the required status checks via [PR #127](https://github.com/yasserfullstack-tech/whatsapp/pull/127); red case [PR #128](https://github.com/yasserfullstack-tech/whatsapp/pull/128) was blocked (`mergeStateStatus: BLOCKED`, `gh pr merge` rejected) and green case [PR #129](https://github.com/yasserfullstack-tech/whatsapp/pull/129) merged gated. Still open (runbook §12 item 5): a per-PR load gate, if wanted, should be added as a guarded job inside that aggregator rather than by requiring `smoke`.
3. ~~Reconcile incorrectly closed readiness issues with their own outstanding evidence requirements.~~ ✅ **Verified complete 2026-09-21** — all six drifted issues (#48, #49, #51, #54, #55, #67) were reopened, the #46–#67 audit is recorded below, and `bun infra/production/scripts/check-readiness-sync.ts` reports 0 mismatches.

## P0 — close paid-launch external evidence

4. Complete PR-002/003/004/005 Meta staging/production evidence.
5. Select and implement the PR-006 production billing provider, complete its sandbox/test lifecycle evidence, and link PR-007 verification to it.
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

The sections below preserve the implementation record and separately state what external evidence or future provider work remains. Their `[x]` headings reflect closed implementation issues, not launch approval.

## [x] PR-001 — Production readiness tracking

**Tracking:** [#46](https://github.com/yasserfullstack-tech/whatsapp/issues/46) · **Implementation:** [#68](https://github.com/yasserfullstack-tech/whatsapp/pull/68)

Verified complete. Continue maintaining this plan and release-gate accuracy.

## [x] PR-002 — Migrate Embedded Signup to the current Meta flow

**Tracking:** [#47](https://github.com/yasserfullstack-tech/whatsapp/issues/47) · **Implementation:** [#70](https://github.com/yasserfullstack-tech/whatsapp/pull/70) · **Repository hardening/verification:** [#116](https://github.com/yasserfullstack-tech/whatsapp/pull/116)

Repository-side v4/config-driven signup, safe callback validation, cancellation/error handling, and automated tests are merged. PR #116 additionally isolates retries by attempt generation and Meta message source, rejects stale callbacks/events, verifies the selected phone belongs to the submitted WABA before saving, and updates the fake Meta contract so protected browser E2E covers the hardened flow. The final PR head passed CI, Security, Production Infra, and the full browser matrix before protected squash merge as `4c0f9a4`; post-merge Load Smoke is green on that exact commit.

**Still needed:** current Meta configuration proof plus one real Meta test/business onboarding with sanitized evidence.

## [x] PR-003 — WhatsApp connection health and reauthorization lifecycle

**Tracking:** [#48](https://github.com/yasserfullstack-tech/whatsapp/issues/48) · **Implementation:** [#79](https://github.com/yasserfullstack-tech/whatsapp/pull/79)

Connection health persistence, credential validation, safe send blocking, UI state, notifications, and reconnect behavior are implemented.

**Still needed:** real staging evidence that a broken/revoked credential is detected and a reconnect safely replaces/restores it without exposing token material.

## [x] PR-004 — Meta asset and account synchronization

**Tracking:** [#49](https://github.com/yasserfullstack-tech/whatsapp/issues/49) · **Implementation:** [#78](https://github.com/yasserfullstack-tech/whatsapp/pull/78)

Template/phone/WABA state handling, idempotent durable webhooks, periodic reconciliation, audit logging, metrics, and alerts are implemented.

**Still needed:** redacted staging evidence for a real provider state transition or reconciliation repair.

## [x] PR-005 — Complete external Meta production prerequisites

**Tracking:** [#50](https://github.com/yasserfullstack-tech/whatsapp/issues/50) · **Runbook:** [#69](https://github.com/yasserfullstack-tech/whatsapp/pull/69)

**Still needed:** app mode/status, business/provider prerequisites where required, Advanced Access/App Review state, production webhook subscription, production Embedded Signup configuration, and real WABA + phone onboarding evidence.

## [x] PR-006 — Implement the real billing provider

**Tracking:** [#51](https://github.com/yasserfullstack-tech/whatsapp/issues/51) · **Implementation:** [#73](https://github.com/yasserfullstack-tech/whatsapp/pull/73)

The provider-neutral billing contract and local plan/subscription/invoice/payment model are implemented. The previous concrete online provider integration has been removed because that provider will not be used. Issue #51 is closed as **not planned** for the current code milestone while replacement-provider selection is intentionally deferred.

**Still needed:** select the production billing provider, implement the required checkout/subscription/payment lifecycle behind the provider-neutral contract, and capture real sandbox/test evidence using an externally reachable test webhook endpoint where required.

## [x] PR-007 — Enforce entitlements and usage limits server-side

**Tracking:** [#52](https://github.com/yasserfullstack-tech/whatsapp/issues/52) · **Implementation:** [#76](https://github.com/yasserfullstack-tech/whatsapp/pull/76)

Server/worker enforcement for paid limits and idempotent usage accounting is implemented. Repository verification on #52 covers direct API/service bypass protection, duplicate/replay-safe accounting, period rollover, tenant isolation, upgrade/downgrade behavior, and the server/worker enforcement boundaries.

**Still needed:** after the production billing provider is selected and implemented, prove its real sandbox/test subscription/payment lifecycle drives these same entitlement paths correctly, together with PR-006/PR-012 provider validation.

## [x] PR-008 — Finalize legal documents and compliance procedures

**Tracking:** [#53](https://github.com/yasserfullstack-tech/whatsapp/issues/53) · **Repository work:** [#74](https://github.com/yasserfullstack-tech/whatsapp/pull/74)

Versioned review drafts, acceptance persistence, configured legal disclosures, and operational runbooks exist.

**Still needed:** qualified legal approval, final real-world entity/jurisdiction/vendor facts, and an approval record. Repository text is not legal approval.

## [x] PR-009 — Provision and validate staging/production infrastructure

**Tracking:** [#54](https://github.com/yasserfullstack-tech/whatsapp/issues/54) · **Repository work:** [#71](https://github.com/yasserfullstack-tech/whatsapp/pull/71)

Isolation guardrails, immutable image/release manifest controls, smoke/evidence collection, and rollback tooling are merged.

**Still needed:** real isolated staging and production deployments, DNS/TLS/firewall proof, separate DB/Valkey/R2/Meta assets, production email/Sentry configuration, and an actual rollback rehearsal with smoke-test success.

## [x] PR-010 — Activate and prove backup/recovery

**Tracking:** [#55](https://github.com/yasserfullstack-tech/whatsapp/issues/55) · **Repository work:** [#77](https://github.com/yasserfullstack-tech/whatsapp/pull/77)

Backup scheduling, encryption/off-server validation, freshness evidence, restore-drill tooling, and R2 strategy documentation are merged.

**Still needed:** actual production schedule activation, a real verified off-server backup, freshness monitoring evidence, a clean-host restore + application smoke test, measured RPO/RTO, and owner acceptance.

## [x] PR-011 — Add actionable production alerting

**Tracking:** [#56](https://github.com/yasserfullstack-tech/whatsapp/issues/56) · **Repository work:** [#75](https://github.com/yasserfullstack-tech/whatsapp/pull/75)

Version-controlled alerts, Alertmanager routing, exporters/probes, SLOs, runbooks, and a synthetic delivery test are merged.

**Still needed:** real delivery proof to the configured human-operated on-call/ops destination.

## [x] PR-012 — Real-provider production validation

**Tracking:** [#57](https://github.com/yasserfullstack-tech/whatsapp/issues/57) · **Evidence tooling:** [#87](https://github.com/yasserfullstack-tech/whatsapp/pull/87)

The manifest, redaction validation, `--require-pass` signoff mode, and summary generation are implemented.

**Still needed:** run every required flow against the real external systems: Meta signup/send/status/failure/inbound/opt-out/reconnect/sync, R2, email, campaign dispatch, supported export/deletion, billing lifecycle, backup/restore, and rollback. Fake-provider CI is regression coverage only.

## [x] PR-013 — Representative load, soak, and recovery validation

**Tracking:** [#58](https://github.com/yasserfullstack-tech/whatsapp/issues/58) · **Evidence tooling:** [#89](https://github.com/yasserfullstack-tech/whatsapp/pull/89)

Representative-run certification, immutable release/config recording, threshold/report requirements, and evidence checksums are implemented.

**Still needed:** run representative infrastructure benchmarks at the workload sizes behind any product claim on the restored green Load Smoke baseline, and attach load/soak/chaos/recovery evidence. Do not infer 100k/500k production capacity from local fake-provider tests.

## [x] PR-014 — Build the inbound WhatsApp inbox

**Tracking:** [#59](https://github.com/yasserfullstack-tech/whatsapp/issues/59) · **Implementation:** [#82](https://github.com/yasserfullstack-tech/whatsapp/pull/82)

Verified complete in the plan. Real-provider message/reply behavior remains part of PR-012 launch validation.

## [x] PR-015 — Support rich WhatsApp templates

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

## [x] PR-019 — Wire the full notification catalog

**Tracking:** [#64](https://github.com/yasserfullstack-tech/whatsapp/issues/64) · **Implementation:** [#86](https://github.com/yasserfullstack-tech/whatsapp/pull/86), [#114](https://github.com/yasserfullstack-tech/whatsapp/pull/114) · **Repository verification:** [#103](https://github.com/yasserfullstack-tech/whatsapp/pull/103), [#110](https://github.com/yasserfullstack-tech/whatsapp/pull/110)

Runtime event sources, preference/mandatory-category handling, replay-safe dedupe, durable reconciliation, persistent restart-safe reconciliation cursor behavior, delayed billing-event replay, observable delivery, and a shared provider-neutral SMTP transport are merged. PR #114 removes the Resend-specific runtime/deployment requirement, uses Google/Gmail as the current SMTP configuration example, bounds SMTP connection/TLS waits, treats server acceptance after DATA as the delivery boundary, and passed CI/browser, Security, Production Infra, and Readiness Sync before protected merge.

**Still needed:** trigger one real email through the deployed staging/production application using the configured SMTP provider (Google initially), then attach redacted evidence showing SMTP acceptance, the application Message-ID/reference, and recipient or Sent-folder proof. Repository CI does not substitute for that external delivery evidence.

## [x] PR-020 — Expand platform admin tooling

**Tracking:** [#65](https://github.com/yasserfullstack-tech/whatsapp/issues/65) · **Implementation:** [#81](https://github.com/yasserfullstack-tech/whatsapp/pull/81) · **Repository verification:** [#98](https://github.com/yasserfullstack-tech/whatsapp/pull/98), [#106](https://github.com/yasserfullstack-tech/whatsapp/pull/106)

Platform-admin access, membership support, billing/Meta visibility, safe queue retry, webhook operations, pagination/search, and audit export are merged without adding impersonation. Repository verification covers privileged authorization/audit boundaries plus real browser operational flows, including queue/dead-letter and webhook retry behavior.

**Still needed:** attach redacted admin-workflow evidence from a real staging/production-like environment. Repository CI/browser evidence does not substitute for that external operational proof.

## [x] PR-021 — Container and supply-chain security hardening

**Tracking:** [#66](https://github.com/yasserfullstack-tech/whatsapp/issues/66) · **Implementation:** [#72](https://github.com/yasserfullstack-tech/whatsapp/pull/72) · **Continuous verification:** [#102](https://github.com/yasserfullstack-tech/whatsapp/pull/102), [#108](https://github.com/yasserfullstack-tech/whatsapp/pull/108)

Frozen Bun installs, OCI source/revision/version labels, Trivy scanning, report artifacts, HIGH/CRITICAL blocking policy, continuous policy-drift checks, and non-root production/migrator execution are merged and green. No finding is suppressed and the severity policy was not weakened.

**Still needed:** the owner must explicitly accept the documented unfixed upstream HIGH findings for the stated review window (currently through 2026-10-20), or replace/remediate the affected base/package once a fix is available. Record that decision/rationale in the release evidence/plan and keep the continuous scans green.

## [x] PR-022 — Application security hardening and independent testing

**Tracking:** [#67](https://github.com/yasserfullstack-tech/whatsapp/issues/67) · **Implementation:** [#88](https://github.com/yasserfullstack-tech/whatsapp/pull/88)

Expanded IDOR/object-storage tests, credential key-rotation exercise/design, RLS decision, and privileged-admin review are merged. Current audited HEAD has green CI, Security, and Production Infra.

**Still needed:** independent security review/pentest for the required release stage, plus remediation/retest or formal acceptance of critical/high findings. The tracking issue is closed under the code-only policy; the independent assessment remains required release evidence.

---

# Completion discipline

Repository implementation closure and launch verification are separate gates.

Before changing a `PR-001`..`PR-022` implementation checkbox to `[x]`, confirm the repository-side scope is merged/tested or explicitly deferred/not planned, link the implementation PR/commit when applicable, close the implementation issue with the appropriate disposition, and update this plan.

Before changing an item under **Launch evidence still required** to `[x]`, confirm the real evidence exists, link the exact release commit and relevant workflow runs, attach or reference sanitized external evidence, and record required reviewer/maintainer sign-off.

A green local/fake-provider test is valuable regression evidence, but it does not substitute for provider, production, legal, recovery, operator-delivery, representative-capacity, or independent-security evidence.

---

# Closing convention for readiness implementation issues

The readiness issues #46–#67 now track **repository implementation disposition**, not launch verification.

- Close an implementation issue once repository-side scope is complete and merged.
- An issue may close as **not planned/deferred** when implementation intentionally depends on a future decision; PR-006/#51 is the current example because the production billing provider is unselected.
- Outstanding external evidence does **not** require reopening the implementation issue.
- A closed implementation issue must never be cited by itself as proof that paid-production launch requirements are complete.

The consistency check remains:

```
bun infra/production/scripts/check-readiness-sync.ts
```

It checks implementation checkbox/issue-state alignment only. A green result does **not** mean the application is production-ready.

---

# Readiness implementation issue-state audit (2026-09-22)

All 22 implementation tracking issues (#46–#67) are closed.

- **Closed as completed:** #46–#50 and #52–#67.
- **Closed as not planned/deferred:** #51, because the replacement production billing provider is intentionally unselected.
- **Policy-tracking issue closed:** #92.

Outstanding Meta/provider/production/legal/recovery/operator/capacity/security evidence remains listed in **Launch evidence still required** and in the task acceptance details above. Those items can remain outstanding while implementation issues stay closed.

---

# Release review step

This step is performed before declaring production readiness or accepting paid-production traffic.

1. Run `bun infra/production/scripts/check-readiness-sync.ts` and confirm zero implementation issue-state mismatches.
2. Confirm every applicable item under **Launch evidence still required** has verified real evidence. Closed implementation issues are not evidence substitutes.
3. Confirm the release commit has the required CI, Security, release-gate, infrastructure, backup/recovery, reporting/scale, and Load Smoke evidence required by the runbooks.
4. Confirm `main` branch protection/ruleset controls remain active and required checks are enforced.
5. Confirm provider-specific production configuration and recovery paths for the providers actually selected for launch.
6. Confirm legal approval, operator alert delivery, backup/restore proof, representative capacity evidence, and independent security review where required.
7. Record the final audit result, evidence links, and release verdict in this document before announcing paid-production readiness.

**Important:** all implementation issues being closed is a codebase milestone, not paid-production approval.
