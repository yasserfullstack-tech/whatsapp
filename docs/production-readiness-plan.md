# Production Readiness Plan

_Last audited against `main`: 2026-09-17_

This document is the source of truth for production-readiness and product-completeness status. It deliberately separates **repository implementation** from **production verification** so merged code, closed GitHub issues, mocks, or documentation are not mistaken for launch evidence.

## Current release verdict

> **NOT CLEARED FOR PAID PRODUCTION TRAFFIC.**

The codebase has substantial production-readiness work merged, but the paid-launch gate is still open because real Meta/provider/production evidence is incomplete and the current `main` HEAD has a failing Load Smoke workflow.

Current audited HEAD before this documentation update:

- Commit: [`149cc1aa4d286ff5ceba7adaf35dda1f2d3e044e`](https://github.com/yasserfullstack-tech/whatsapp/commit/149cc1aa4d286ff5ceba7adaf35dda1f2d3e044e)
- CI: **success** — [run 35209808808](https://github.com/yasserfullstack-tech/whatsapp/actions/runs/35209808808)
- Security: **success** — [run 35209808801](https://github.com/yasserfullstack-tech/whatsapp/actions/runs/35209808801)
- Production Infra: **success** — [run 35209808836](https://github.com/yasserfullstack-tech/whatsapp/actions/runs/35209808836)
- Load Smoke: **failure** — [run 35209808796](https://github.com/yasserfullstack-tech/whatsapp/actions/runs/35209808796)
- `main` branch protection: **disabled**; required status checks are not enforced by branch protection.

The failed Load Smoke job reached the composed upload/throughput/send smoke step and failed there; its artifact-upload step also failed. The exact runtime root cause is **not yet verified** because job-log retrieval was unavailable during this audit. Do not guess the cause; investigate the run directly and rerun it to green.

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

## 1. Current `main` is red on Load Smoke

[Load Smoke run 35209808796](https://github.com/yasserfullstack-tech/whatsapp/actions/runs/35209808796) failed on audited HEAD `149cc1aa...`. This must be investigated and rerun successfully before treating the current release candidate as healthy.

## 2. `main` is not protected

GitHub reports `main` with branch protection disabled and required status-check enforcement off. That allows code to land even when a workflow is red. At minimum, CI, Security, Production Infra where applicable, and the release-relevant load/reliability gate should be enforced through branch protection/rulesets or an equivalent required-PR policy.

## 3. Tracking issues and readiness evidence have drifted apart

Some issues are currently closed even though their PRs/comments explicitly say required evidence remains. Examples found during this audit:

- PR-004 / [#49](https://github.com/yasserfullstack-tech/whatsapp/issues/49): comments say real Meta staging state-change/reconciliation evidence is still required, but the issue is closed.
- PR-009 / [#54](https://github.com/yasserfullstack-tech/whatsapp/issues/54): comment says real staging/production deployment, DNS/TLS/firewall, isolation, and rollback evidence is still required, but the issue is closed.
- PR-010 / [#55](https://github.com/yasserfullstack-tech/whatsapp/issues/55): comments say real production backup/clean-host restore/RPO-RTO evidence is still required, but the issue is closed.
- PR-022 / [#67](https://github.com/yasserfullstack-tech/whatsapp/issues/67): comments say independent security assessment/pentest evidence is still required, but the issue is closed.
- PR-006 / [#51](https://github.com/yasserfullstack-tech/whatsapp/issues/51): the implementation PR states real Stripe test-mode lifecycle evidence was not yet claimed, while the tracking issue is closed.
- PR-003 / [#48](https://github.com/yasserfullstack-tech/whatsapp/issues/48): the implementation PR says real staging reconnect evidence remains an operational validation item, while the tracking issue is closed.

**Action:** reopen an issue when its required evidence is genuinely outstanding, or attach/review the missing evidence before leaving it closed. Do not use issue state alone as the release gate.

## 4. Mock/local regression coverage is not provider acceptance

The repository has strong local/fake-provider regression coverage, but fake Meta, mock Stripe, local R2/S3, or synthetic email cannot close the provider-production acceptance gate. PR-012 exists specifically to require real-provider evidence.

---

# Current task status

| Task | Readiness | Repository implementation | What is still required |
| --- | --- | --- | --- |
| PR-001 Production readiness tracking | ✅ `[x]` | Merged via [#68](https://github.com/yasserfullstack-tech/whatsapp/pull/68) | Keep this plan current and keep merge gates accurate. |
| PR-002 Current Meta Embedded Signup | 🟦 ⏳ `[ ]` | v4/config-driven flow merged via [#70](https://github.com/yasserfullstack-tech/whatsapp/pull/70) | Verify current production/test Meta config ID and complete a real Meta test-business onboarding with redacted evidence in [#47](https://github.com/yasserfullstack-tech/whatsapp/issues/47). |
| PR-003 Connection health / reauthorization | 🟦 ⏳ `[ ]` | Lifecycle/validation/reconnect work merged via [#79](https://github.com/yasserfullstack-tech/whatsapp/pull/79) | Attach real staging reconnect/credential-replacement evidence; reconcile the currently closed [#48](https://github.com/yasserfullstack-tech/whatsapp/issues/48) with that missing evidence. |
| PR-004 Meta asset/account synchronization | 🟦 ⏳ `[ ]` | Webhook/reconciliation/audit/metrics work merged via [#78](https://github.com/yasserfullstack-tech/whatsapp/pull/78) | Capture a real Meta state transition or reconciliation repair in staging; [#49](https://github.com/yasserfullstack-tech/whatsapp/issues/49) is closed despite comments saying this evidence is still required. |
| PR-005 External Meta prerequisites | ⏳ `[ ]` | Evidence runbook merged via [#69](https://github.com/yasserfullstack-tech/whatsapp/pull/69) | Production Meta approvals/access, webhook/configuration, real WABA/phone onboarding, and sanitized proof in [#50](https://github.com/yasserfullstack-tech/whatsapp/issues/50). |
| PR-006 Real billing provider | 🟦 ⏳ `[ ]` | Stripe provider/lifecycle/webhook code merged via [#73](https://github.com/yasserfullstack-tech/whatsapp/pull/73) | Run the documented real Stripe test-mode lifecycle: Checkout, webhooks, upgrade/downgrade, portal, failed-payment recovery, cancel, replay, refund. Reconcile closed [#51](https://github.com/yasserfullstack-tech/whatsapp/issues/51) with the missing evidence. |
| PR-007 Server-side entitlements | 🟦 `[ ]` | Enforcement/accounting merged via [#76](https://github.com/yasserfullstack-tech/whatsapp/pull/76) | Backfill/confirm final task evidence against the DoD and provider-linked billing behavior; keep paid-launch verification tied to PR-006/PR-012. |
| PR-008 Legal/compliance | 🟦 ⏳ `[ ]` | Versioned drafts, acceptance storage, and runbooks merged via [#74](https://github.com/yasserfullstack-tech/whatsapp/pull/74) | Qualified legal review/approval, final entity/jurisdiction/vendor details, and approval evidence in [#53](https://github.com/yasserfullstack-tech/whatsapp/issues/53). |
| PR-009 Staging/production infrastructure | 🟦 ⏳ `[ ]` | Isolation/immutable release/evidence/rollback tooling merged via [#71](https://github.com/yasserfullstack-tech/whatsapp/pull/71) | Real staging + production deployment proof, DNS/TLS/firewall, environment isolation, email/Sentry/Meta config, and actual rollback drill. [#54](https://github.com/yasserfullstack-tech/whatsapp/issues/54) is closed despite this evidence gap. |
| PR-010 Backup/recovery | 🟦 ⏳ `[ ]` | Backup scheduling, off-server validation, restore drill tooling merged via [#77](https://github.com/yasserfullstack-tech/whatsapp/pull/77) | Real production timer/backup, freshness monitoring, clean-host restore + app smoke test, measured recovery, and accepted RPO/RTO/R2 strategy. [#55](https://github.com/yasserfullstack-tech/whatsapp/issues/55) is closed despite this gap. |
| PR-011 Production alerting | 🟦 ⏳ `[ ]` | Alert rules, Alertmanager, exporters/probes, runbooks merged via [#75](https://github.com/yasserfullstack-tech/whatsapp/pull/75) | Trigger test alerts and prove delivery to a real human-operated destination; attach evidence to [#56](https://github.com/yasserfullstack-tech/whatsapp/issues/56). |
| PR-012 Real-provider validation | 🟦 ⏳ `[ ]` | Evidence manifest/validator/signoff tooling merged via [#87](https://github.com/yasserfullstack-tech/whatsapp/pull/87) | Execute every required real-provider flow and recovery case, validate with `--require-pass`, review/redact artifacts, attach results to [#57](https://github.com/yasserfullstack-tech/whatsapp/issues/57). |
| PR-013 Representative scale validation | 🟦 ⏳ ⚠️ `[ ]` | Certification/evidence controls merged via [#89](https://github.com/yasserfullstack-tech/whatsapp/pull/89) | Fix current Load Smoke failure first, then run representative staging/production-like load/soak/chaos/recovery with immutable release evidence and attach artifacts to [#58](https://github.com/yasserfullstack-tech/whatsapp/issues/58). |
| PR-014 Inbound inbox | ✅ `[x]` | Merged via [#82](https://github.com/yasserfullstack-tech/whatsapp/pull/82) | Maintain regression/provider validation under PR-012. |
| PR-015 Rich WhatsApp templates | 🟦 ⏳ `[ ]` | Rich components/preview/bindings/validation merged via [#80](https://github.com/yasserfullstack-tech/whatsapp/pull/80) | Approved representative rich template + real staging send evidence in [#60](https://github.com/yasserfullstack-tech/whatsapp/issues/60). |
| PR-016 Campaign scheduling | 🟦 `[ ]` | Scheduling/timezone/idempotent dispatch/cancel/reschedule merged via [#83](https://github.com/yasserfullstack-tech/whatsapp/pull/83) | Backfill explicit final CI/browser evidence against the DoD before promoting the plan checkbox. |
| PR-017 Onboarding test mode | ✅ `[x]` | Merged and verified via [#85](https://github.com/yasserfullstack-tech/whatsapp/pull/85) | Maintain regression coverage. |
| PR-018 Contact management | 🟦 `[ ]` | CRUD/custom fields/tags/notes/import mapping/bulk/merge/pagination merged via [#84](https://github.com/yasserfullstack-tech/whatsapp/pull/84) | Backfill explicit plan verification/evidence links before promoting the checkbox. |
| PR-019 Notification runtime | 🟦 `[ ]` | Runtime event sources/dedupe/preferences/reconciliation merged via [#86](https://github.com/yasserfullstack-tech/whatsapp/pull/86) | Backfill explicit plan verification and any applicable production delivery evidence. |
| PR-020 Platform admin tooling | 🟦 `[ ]` | Admin access/billing/Meta/queue/webhook/audit tooling merged via [#81](https://github.com/yasserfullstack-tech/whatsapp/pull/81) | Backfill final authorization/security/operational evidence before promoting the checkbox. |
| PR-021 Container/supply-chain security | 🟦 `[ ]` | Frozen installs, provenance labels, Trivy scans and blocking policy merged via [#72](https://github.com/yasserfullstack-tech/whatsapp/pull/72) | Confirm/link final scan artifacts and policy evidence for the release; current Security/Production Infra are green on audited HEAD. |
| PR-022 Application security / independent testing | 🟦 ⏳ `[ ]` | IDOR/object-storage/rotation/RLS/admin hardening merged via [#88](https://github.com/yasserfullstack-tech/whatsapp/pull/88) | Independent assessment/pentest plus remediation/retest or formal acceptance of critical/high findings. [#67](https://github.com/yasserfullstack-tech/whatsapp/issues/67) is closed even though its comments say this remains outstanding. |

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
- [ ] Current Load Smoke failure resolved and rerun green.

---

# Product-completeness / post-launch gate

These items do not necessarily block the first paid launch unless explicitly promised in launch scope, but their status must still distinguish implementation from verification.

- [x] PR-014 Inbound inbox — [#59](https://github.com/yasserfullstack-tech/whatsapp/issues/59)
- [ ] PR-015 Rich WhatsApp templates — [#60](https://github.com/yasserfullstack-tech/whatsapp/issues/60)
- [ ] PR-016 Campaign scheduling/automation foundation — [#61](https://github.com/yasserfullstack-tech/whatsapp/issues/61)
- [x] PR-017 Onboarding test mode — [#62](https://github.com/yasserfullstack-tech/whatsapp/issues/62)
- [ ] PR-018 Contact management depth — [#63](https://github.com/yasserfullstack-tech/whatsapp/issues/63)
- [ ] PR-019 Full notification runtime — [#64](https://github.com/yasserfullstack-tech/whatsapp/issues/64)
- [ ] PR-020 Expanded platform admin tooling — [#65](https://github.com/yasserfullstack-tech/whatsapp/issues/65)
- [ ] PR-021 Container/supply-chain hardening — [#66](https://github.com/yasserfullstack-tech/whatsapp/issues/66)
- [ ] PR-022 Application security hardening / independent testing — [#67](https://github.com/yasserfullstack-tech/whatsapp/issues/67)

---

# Immediate work queue

## P0 — release health and controls

1. Investigate [Load Smoke run 35209808796](https://github.com/yasserfullstack-tech/whatsapp/actions/runs/35209808796), fix the verified cause, rerun, and require a green release-relevant load gate.
2. Protect `main` (or add an equivalent ruleset) so required CI/Security/release checks cannot be bypassed.
3. Reconcile incorrectly closed readiness issues with their own outstanding evidence requirements.

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
13. Backfill explicit final evidence/checklist review for PR-016, PR-018, PR-019, PR-020, and PR-021.
14. Complete PR-022 independent security assessment/pentest and remediation gate.

---

# Task acceptance details

The sections below preserve the intended acceptance criteria while focusing on what remains.

## [x] PR-001 — Production readiness tracking

**Tracking:** [#46](https://github.com/yasserfullstack-tech/whatsapp/issues/46) · **Implementation:** [#68](https://github.com/yasserfullstack-tech/whatsapp/pull/68)

Verified complete. Continue maintaining this plan and release-gate accuracy.

## [ ] PR-002 — Migrate Embedded Signup to the current Meta flow

**Tracking:** [#47](https://github.com/yasserfullstack-tech/whatsapp/issues/47) · **Implementation:** [#70](https://github.com/yasserfullstack-tech/whatsapp/pull/70)

Repository-side v4/config-driven signup, safe callback validation, cancellation/error handling, and automated tests are merged.

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

Server/worker enforcement for paid limits and idempotent usage accounting is implemented.

**Still needed:** explicit release evidence review showing all paid limits and billing-state transitions satisfy the DoD; provider-dependent behavior must be proven together with PR-006/PR-012.

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

**Still needed:** first fix the current Load Smoke failure, then run representative infrastructure benchmarks at the workload sizes behind any product claim and attach load/soak/chaos/recovery evidence. Do not infer 100k/500k production capacity from local fake-provider tests.

## [x] PR-014 — Build the inbound WhatsApp inbox

**Tracking:** [#59](https://github.com/yasserfullstack-tech/whatsapp/issues/59) · **Implementation:** [#82](https://github.com/yasserfullstack-tech/whatsapp/pull/82)

Verified complete in the plan. Real-provider message/reply behavior remains part of PR-012 launch validation.

## [ ] PR-015 — Support rich WhatsApp templates

**Tracking:** [#60](https://github.com/yasserfullstack-tech/whatsapp/issues/60) · **Implementation:** [#80](https://github.com/yasserfullstack-tech/whatsapp/pull/80)

Structural text/image/video/document headers, buttons, preview, parameter mapping, validation, and send rendering are merged for the supported families.

**Still needed:** redacted evidence for an approved representative rich template and a real staging send through Meta.

## [ ] PR-016 — Campaign scheduling and automation foundation

**Tracking:** [#61](https://github.com/yasserfullstack-tech/whatsapp/issues/61) · **Implementation:** [#83](https://github.com/yasserfullstack-tech/whatsapp/pull/83)

Scheduling, workspace timezone handling, no-early-dispatch behavior, idempotent claims, dispatch-time audience snapshotting, cancel/reschedule, UI state, and tests are merged.

**Still needed:** explicitly link/review the final green CI/browser evidence against every DoD item before changing this checkbox to `[x]`.

## [x] PR-017 — Implement real onboarding test mode

**Tracking:** [#62](https://github.com/yasserfullstack-tech/whatsapp/issues/62) · **Implementation:** [#85](https://github.com/yasserfullstack-tech/whatsapp/pull/85)

Verified complete with server-enforced recipient limits, direct-API bypass protection, success/failure onboarding semantics, and automated/browser coverage.

## [ ] PR-018 — Complete contact management

**Tracking:** [#63](https://github.com/yasserfullstack-tech/whatsapp/issues/63) · **Implementation:** [#84](https://github.com/yasserfullstack-tech/whatsapp/pull/84)

Manual CRUD, custom fields/tags/notes, import mapping, activity, bulk operations, auditable merge, permission checks, consent invariants, and keyset pagination are merged.

**Still needed:** backfill the explicit final verification links/performance evidence required by the task before promoting the plan checkbox.

## [ ] PR-019 — Wire the full notification catalog

**Tracking:** [#64](https://github.com/yasserfullstack-tech/whatsapp/issues/64) · **Implementation:** [#86](https://github.com/yasserfullstack-tech/whatsapp/pull/86)

Runtime event sources, preference/mandatory-category handling, replay-safe dedupe, durable reconciliation, and observable delivery are merged.

**Still needed:** backfill explicit final verification and any applicable real-provider delivery evidence before promoting the checkbox.

## [ ] PR-020 — Expand platform admin tooling

**Tracking:** [#65](https://github.com/yasserfullstack-tech/whatsapp/issues/65) · **Implementation:** [#81](https://github.com/yasserfullstack-tech/whatsapp/pull/81)

Platform-admin access, membership support, billing/Meta visibility, safe queue retry, webhook operations, pagination/search, and audit export are merged without adding impersonation.

**Still needed:** explicit final authorization/security/operational evidence review against the task DoD.

## [ ] PR-021 — Container and supply-chain security hardening

**Tracking:** [#66](https://github.com/yasserfullstack-tech/whatsapp/issues/66) · **Implementation:** [#72](https://github.com/yasserfullstack-tech/whatsapp/pull/72)

Frozen Bun installs, lockfile repair after reproduced failure, OCI source/revision/version labels, Trivy scanning, report artifacts, and HIGH/CRITICAL blocking policy are merged.

**Still needed:** ensure the release evidence contains the scan artifacts/policy outcome and any approved exception rationale. Keep the control continuous even after this checkbox is eventually verified.

## [ ] PR-022 — Application security hardening and independent testing

**Tracking:** [#67](https://github.com/yasserfullstack-tech/whatsapp/issues/67) · **Implementation:** [#88](https://github.com/yasserfullstack-tech/whatsapp/pull/88)

Expanded IDOR/object-storage tests, credential key-rotation exercise/design, RLS decision, and privileged-admin review are merged. Current audited HEAD has green CI, Security, and Production Infra.

**Still needed:** independent security review/pentest for the required release stage, plus remediation/retest or formal acceptance of critical/high findings. The tracking issue is currently closed even though its own comments say this evidence remains outstanding.

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
