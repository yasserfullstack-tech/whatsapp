# Production Readiness Plan

_Last audited against `main`: 2026-09-20_

This document is the source of truth for production-readiness and product-completeness status. It deliberately separates **repository implementation** from **production verification** so merged code, closed GitHub issues, mocks, or documentation are not mistaken for launch evidence.

## Current release verdict

> **NOT CLEARED FOR PAID PRODUCTION TRAFFIC.**

The codebase has substantial production-readiness work merged, but the paid-launch gate is still open because real Meta/provider/production/legal/security evidence is incomplete and `main` release controls are not yet enforced. The previously failing Load Smoke gate has been fixed and is green.

Current audited `main`:

- Commit: [`8c373540111d01c3968d2bd95b6b5618066a323b`](https://github.com/yasserfullstack-tech/whatsapp/commit/8c373540111d01c3968d2bd95b6b5618066a323b)
- CI: **success** — [run 35437481703](https://github.com/yasserfullstack-tech/whatsapp/actions/runs/35437481703)
- Security: **success** — [run 35437481670](https://github.com/yasserfullstack-tech/whatsapp/actions/runs/35437481670)
- Load Smoke: **success** — [run 35437481771](https://github.com/yasserfullstack-tech/whatsapp/actions/runs/35437481771)
- Readiness Issue Sync: **success** — [run 35437481734](https://github.com/yasserfullstack-tech/whatsapp/actions/runs/35437481734)
- Repository rulesets: **none active**; the ruleset collection is still empty, so required merge checks are not yet enforced.

Load Smoke issue [#90](https://github.com/yasserfullstack-tech/whatsapp/issues/90) is closed after the billing-fixture root cause was fixed and the green `main` rerun was verified. The current release-control blocker is [#91](https://github.com/yasserfullstack-tech/whatsapp/issues/91): apply and verify the prepared `main-release-controls` ruleset, prove a failing required check blocks merge, then prove a fully green PR merges through the active policy.

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

# Current launch blockers and recent fixes

## 1. Load Smoke regression is resolved

The previously failing release smoke is fixed. [Load Smoke run 35437481771](https://github.com/yasserfullstack-tech/whatsapp/actions/runs/35437481771) is green on `main` commit `8c373540...`, and [#90](https://github.com/yasserfullstack-tech/whatsapp/issues/90) is closed with the root-cause and recovery evidence recorded. Keep the release-relevant smoke gate green on future release candidates.

## 2. `main` release controls are still not active

The policy and runbook are merged, but the repository ruleset collection is still empty. See [`docs/release-controls.md`](release-controls.md) and [`.github/rulesets/main.json`](../.github/rulesets/main.json). [#91](https://github.com/yasserfullstack-tech/whatsapp/issues/91) remains the immediate control-plane blocker: activate the prepared ruleset, verify the exact required contexts, demonstrate a red PR is blocked, and use the preserved green PR [#96](https://github.com/yasserfullstack-tech/whatsapp/pull/96) to prove normal protected merging.

## 3. Readiness issue-state drift is guarded; final launch reconciliation remains

[#92](https://github.com/yasserfullstack-tech/whatsapp/issues/92) added an automated plan/issue consistency check plus a manual release-review job. The last recorded audit reported `22 items audited, 0 mismatch(es)`. The closing-keyword convention is also documented below.

The remaining #92 acceptance item is the final launch review itself: rerun the consistency check after the release-control and external-evidence work is complete, reconcile all PR-001…PR-022 checkbox/issue states, and record the final release verdict.

## 4. Mock/local regression coverage is not provider acceptance

The repository has strong local/fake-provider regression coverage, but fake Meta, mock Stripe, local R2/S3, synthetic email delivery, and local infrastructure do not replace the explicitly required real-provider/production evidence. Those tasks remain unchecked until their tracking issues contain sanitized external evidence.

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

1. Activate and verify the prepared `main` ruleset in [#91](https://github.com/yasserfullstack-tech/whatsapp/issues/91), including the red blocked-merge probe and green merge-through-protection proof using [#96](https://github.com/yasserfullstack-tech/whatsapp/pull/96).
2. After #96 lands, merge the staged verification PRs [#97](https://github.com/yasserfullstack-tech/whatsapp/pull/97) and [#98](https://github.com/yasserfullstack-tech/whatsapp/pull/98), then reconcile PR-018/PR-020 issue and checkbox state.
3. Keep Load Smoke green on release candidates and run the #92 release-review consistency check before any launch decision.

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
13. Complete PR-016 by merging the preserved green verification PR #96 after #91 is active.
14. Land PR-018 verification PR #97 and PR-020 verification PR #98 after #96; PR-021 repository evidence is already recorded on #66 and only needs synchronized checkbox/issue promotion.
15. Complete PR-019 real email-provider delivery evidence.
16. Complete PR-022 independent security assessment/pentest and remediation gate.

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

**Verification staged:** [#97](https://github.com/yasserfullstack-tech/whatsapp/pull/97) adds direct CRUD/bulk/merge/permission/tenant-isolation/keyset-pagination evidence and is fully green. Its CI run traversed 1,205 contacts in 13 bounded pages and confirmed PostgreSQL used `contacts_org_phone_uq`.

**Still needed:** land #97 on `main` after the #91/#96 protected-merge sequence, then close #63 and promote this checkbox in the same review.

## [ ] PR-019 — Wire the full notification catalog

**Tracking:** [#64](https://github.com/yasserfullstack-tech/whatsapp/issues/64) · **Implementation:** [#86](https://github.com/yasserfullstack-tech/whatsapp/pull/86)

Runtime event sources, preference/mandatory-category handling, replay-safe dedupe, durable reconciliation, and observable delivery are merged.

Repository-side dedupe, preference, mandatory-category, retry/failure, browser, and tenant-isolation evidence has been reviewed and recorded on #64.

**Still needed:** attach redacted real email-provider delivery evidence (production uses Resend) before promoting this checkbox.

## [ ] PR-020 — Expand platform admin tooling

**Tracking:** [#65](https://github.com/yasserfullstack-tech/whatsapp/issues/65) · **Implementation:** [#81](https://github.com/yasserfullstack-tech/whatsapp/pull/81)

Platform-admin access, membership support, billing/Meta visibility, safe queue retry, webhook operations, pagination/search, and audit export are merged without adding impersonation.

**Verification staged:** [#98](https://github.com/yasserfullstack-tech/whatsapp/pull/98) adds real failed-queue-job retry and durable webhook-retry browser evidence. Root tests, typecheck, build, browser E2E, Security, and CodeQL are green on the PR.

**Still needed:** land #98 on `main` after the #91/#96 protected-merge sequence, then close #65 and promote this checkbox in the same review.

## [ ] PR-021 — Container and supply-chain security hardening

**Tracking:** [#66](https://github.com/yasserfullstack-tech/whatsapp/issues/66) · **Implementation:** [#72](https://github.com/yasserfullstack-tech/whatsapp/pull/72)

Frozen Bun installs, lockfile repair after reproduced failure, OCI source/revision/version labels, Trivy scanning, report artifacts, and HIGH/CRITICAL blocking policy are merged.

Repository verification is complete and recorded on #66: PR-021's Production Infra run built and scanned all four production images, uploaded the retained Trivy artifact, verified OCI labels, and passed every fixable HIGH/CRITICAL policy gate; CI and Security were green and no vulnerability exception was required.

**Still needed:** synchronize the plan checkbox and #66 issue state in the same post-#91 review. Keep this continuous control enabled after promotion.

## [ ] PR-022 — Application security hardening and independent testing

**Tracking:** [#67](https://github.com/yasserfullstack-tech/whatsapp/issues/67) · **Implementation:** [#88](https://github.com/yasserfullstack-tech/whatsapp/pull/88)

Expanded IDOR/object-storage tests, credential key-rotation exercise/design, RLS decision, and privileged-admin review are merged. Current audited HEAD has green CI, Security, and Production Infra.

**Still needed:** independent security review/pentest for the required release stage, plus remediation/retest or formal acceptance of critical/high findings. #67 is open and intentionally remains open until that external evidence is attached.

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
- External-evidence tracking issues are **never** closed by repository CI alone. A merge that auto-closes one of #46–#67 must first carry real evidence of completion, or the issue must be reopened and the plan checkbox left unchecked.
- When a readiness checkbox is promoted to `[x]`, the same change/review must confirm the tracking issue can be closed and that evidence links are present on the issue.
- If a tracking issue was auto-closed by a merge while evidence is still outstanding, reopen it and keep the corresponding plan checkbox unchecked.

A minimal automated check enforces this contract:

```
bun infra/production/scripts/check-readiness-sync.ts
```

It parses the top-level `PR-001`..`PR-022` checklist in this file, queries each tracking issue's state, and fails when a checked item has an open issue or an unchecked item has a closed issue.

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
4. Confirm `main` branch protection and required release-relevant status checks (CI, Security, Production Infra, representative load gate) are enforced.
5. Confirm the current Load Smoke workflow is green on the release commit.
6. Record the audit result and release-verdict evidence in `docs/production-readiness-plan.md` under "Current release verdict" before announcing readiness.
