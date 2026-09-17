# Production Readiness Plan

This document is the source of truth for closing the production-readiness and product-completeness gaps identified in the repository audit.

## How to use this plan

- Create **one branch per top-level task** using the suggested branch name.
- Keep the task unchecked while implementation, tests, documentation, or external evidence are incomplete.
- Check a task only after every item under **Definition of done** is complete.
- Prefer one pull request per task. If a task is too large, split it into sub-PRs that target the same task branch or use clearly linked child branches.
- Every PR should reference this file and update the relevant checkbox when the task is genuinely complete.
- For external items such as Meta approval, production DNS, backup execution, or legal approval, attach evidence in the PR/issue before checking the task.
- Do not treat documentation alone as proof that an operational control is active.

## Status legend

- `[ ]` Not complete
- `[x]` Complete and verified
- **Launch blocker**: must be complete before accepting normal paid production customers.
- **Product scope**: may ship after initial launch unless it is part of the promised launch offering.
- **Continuous**: remains an ongoing security/operations responsibility.

## Tracking index

Every top-level task has an assigned GitHub issue with acceptance criteria, dependencies, and evidence requirements. The repository owner, `@yasserfullstack-tech`, is the initial owner for all tasks and can reassign them as execution is delegated.

| Task | Tracking issue | Classification |
| --- | --- | --- |
| PR-001 Production readiness tracking | [#46](https://github.com/yasserfullstack-tech/whatsapp/issues/46) | Launch blocker |
| PR-002 Current Meta Embedded Signup migration | [#47](https://github.com/yasserfullstack-tech/whatsapp/issues/47) | Launch blocker / Meta / external evidence |
| PR-003 Connection health and reauthorization | [#48](https://github.com/yasserfullstack-tech/whatsapp/issues/48) | Launch blocker / Meta / security |
| PR-004 Meta asset/account synchronization | [#49](https://github.com/yasserfullstack-tech/whatsapp/issues/49) | Launch blocker / Meta |
| PR-005 External Meta production prerequisites | [#50](https://github.com/yasserfullstack-tech/whatsapp/issues/50) | Launch blocker / Meta / external evidence |
| PR-006 Real billing provider | [#51](https://github.com/yasserfullstack-tech/whatsapp/issues/51) | Launch blocker / billing |
| PR-007 Server-side entitlement enforcement | [#52](https://github.com/yasserfullstack-tech/whatsapp/issues/52) | Launch blocker / billing / security |
| PR-008 Legal and compliance | [#53](https://github.com/yasserfullstack-tech/whatsapp/issues/53) | Launch blocker / external evidence |
| PR-009 Staging/production infrastructure | [#54](https://github.com/yasserfullstack-tech/whatsapp/issues/54) | Launch blocker / ops / external evidence |
| PR-010 Backup/recovery proof | [#55](https://github.com/yasserfullstack-tech/whatsapp/issues/55) | Launch blocker / ops / external evidence |
| PR-011 Production alerting | [#56](https://github.com/yasserfullstack-tech/whatsapp/issues/56) | Launch blocker / ops / external evidence |
| PR-012 Real-provider validation | [#57](https://github.com/yasserfullstack-tech/whatsapp/issues/57) | Launch blocker / ops / Meta / billing / external evidence |
| PR-013 Representative scale validation | [#58](https://github.com/yasserfullstack-tech/whatsapp/issues/58) | Launch blocker / ops / external evidence |
| PR-014 Inbound inbox | [#59](https://github.com/yasserfullstack-tech/whatsapp/issues/59) | Product scope / Meta |
| PR-015 Rich WhatsApp templates | [#60](https://github.com/yasserfullstack-tech/whatsapp/issues/60) | Product scope / Meta |
| PR-016 Campaign scheduling/automation | [#61](https://github.com/yasserfullstack-tech/whatsapp/issues/61) | Product scope |
| PR-017 Onboarding test mode | [#62](https://github.com/yasserfullstack-tech/whatsapp/issues/62) | Product scope / security |
| PR-018 Contact management | [#63](https://github.com/yasserfullstack-tech/whatsapp/issues/63) | Product scope / security |
| PR-019 Notification runtime | [#64](https://github.com/yasserfullstack-tech/whatsapp/issues/64) | Product scope / ops |
| PR-020 Platform admin tooling | [#65](https://github.com/yasserfullstack-tech/whatsapp/issues/65) | Product scope / ops / security |
| PR-021 Container/supply-chain security | [#66](https://github.com/yasserfullstack-tech/whatsapp/issues/66) | Continuous / security / ops |
| PR-022 Application security / independent testing | [#67](https://github.com/yasserfullstack-tech/whatsapp/issues/67) | Continuous / security / external evidence |

The readiness labels now in use are `launch-blocker`, `product-scope`, `security`, `meta`, `billing`, `ops`, and `external-evidence`.

## Current CI/E2E baseline

Verified on **2026-09-16** against the most recent merged product PR head, `5cc8bd3b350b1e7b256c3beb6d05a3343378ff46` from PR #42:

- CI run #394: **success**.
- Unit/integration tests (`bun run test`): **success**.
- Typecheck (`bun run typecheck`): **success**.
- Production build (`bun run build`): **success**.
- Browser E2E (EN/AR · desktop/tablet/mobile): **success**.
- Security run #306: **success**.
- Production Infra run #148: **success**.
- Webhook Reliability Load Validation run #141: **skipped by path filter**, not failed.

The newer `main` commit `c478e524070ec45e7315c10fdcb1d2ceb2cca32f` only added this readiness plan and has no PR-triggered workflow runs attached. Browser E2E has therefore been successfully executed on the latest merged product change; older notes must not claim that it has never run successfully. A Bun lockfile defect must likewise not be claimed unless a frozen install reproduces one.

---

# Phase 0 — Release control

## [x] PR-001 — Production readiness tracking

**Tracking issue:** [#46](https://github.com/yasserfullstack-tech/whatsapp/issues/46)

**Suggested branch:** `chore/production-readiness-tracking`

**Priority:** Launch blocker

### Work

- Create/link GitHub issues for every task in this document.
- Add labels for `launch-blocker`, `product-scope`, `security`, `meta`, `billing`, `ops`, and `external-evidence`.
- Add an owner to every task.
- Record dependencies between tasks.
- Keep successful CI, typecheck, build, security checks, and browser E2E as required merge gates.
- Remove stale claims from earlier readiness notes, especially any claim that browser E2E has never run successfully.
- Do not claim the Bun lockfile is broken unless a frozen install reproduces the problem.

### Definition of done

- [x] Every task below has a corresponding GitHub issue.
- [x] Every issue has an owner, acceptance criteria, dependencies, and evidence requirements.
- [x] Repository readiness documentation points to this file as the main checklist.
- [x] Current CI/E2E status is documented accurately.

---

# Phase 1 — Meta / WhatsApp production integration

## [ ] PR-002 — Migrate Embedded Signup to the current Meta flow

**Tracking issue:** [#47](https://github.com/yasserfullstack-tech/whatsapp/issues/47)

**Suggested branch:** `feat/meta-embedded-signup-v4`

**Priority:** Launch blocker

### Work

- Review the current official Meta Embedded Signup / Facebook Login for Business requirements.
- Replace the legacy signup configuration used in `apps/web/components/connect-whatsapp.tsx`.
- Remove the current `sessionInfoVersion: "3"` usage if it is not part of the current official flow being used.
- Create/use the correct Meta configuration ID for the current flow.
- Move permission/product configuration into Meta configuration where required.
- Validate the `WA_EMBEDDED_SIGNUP` completion payload.
- Add regression tests around successful, cancelled, invalid, and incomplete signup flows.
- Do not use Twilio documentation as the authoritative specification for this implementation.

### Definition of done

- [ ] Current official Meta documentation is linked in the issue/PR.
- [ ] Legacy v3-specific client behavior is removed where required.
- [ ] Signup succeeds using the current Meta configuration.
- [ ] Cancellation and invalid responses fail safely.
- [ ] Automated tests cover the signup client flow.
- [ ] A real Meta test/business onboarding has been completed and evidence attached.

## [ ] PR-003 — WhatsApp connection health and reauthorization lifecycle

**Tracking issue:** [#48](https://github.com/yasserfullstack-tech/whatsapp/issues/48)

**Suggested branch:** `feat/meta-connection-health`

**Priority:** Launch blocker

### Work

- Extend the WhatsApp connection model with health/lifecycle state.
- Track fields such as `lastValidatedAt`, health status, reauthorization requirement, safe failure reason/code, and credential expiration metadata when Meta actually supplies it.
- Add a periodic credential/connection validation job.
- Detect revoked, invalid, or unusable credentials.
- Stop sends safely when the connection is unusable.
- Surface connection health in the UI/admin surfaces.
- Provide a clear reconnect/reauthorize action.
- Notify workspace admins when reconnection is required.
- Avoid inventing a generic OAuth refresh-token flow unless the Meta API being used actually provides one.

### Definition of done

- [ ] Connection health is persisted.
- [ ] Invalid credentials are detected automatically.
- [ ] Sends fail safely without uncontrolled retry loops.
- [ ] Admin/user UI clearly reports connection problems.
- [ ] Reconnect flow restores a broken connection.
- [ ] Automated tests cover valid, revoked, expired/unusable, and recovered states.

## [ ] PR-004 — Meta asset and account synchronization

**Tracking issue:** [#49](https://github.com/yasserfullstack-tech/whatsapp/issues/49)

**Suggested branch:** `feat/meta-asset-sync`

**Priority:** Launch blocker

### Work

- Process relevant Meta webhook events beyond message delivery status.
- Synchronize template approval/rejection/paused/disabled state.
- Synchronize phone-number metadata and quality state where supported.
- Synchronize WABA/account restrictions or important account state changes.
- Persist useful display-name / verification state where supported.
- Add a periodic reconciliation job so webhooks are not the only source of truth.
- Make handlers idempotent and safe for replay/out-of-order delivery.
- Add audit logging for important state changes.

### Definition of done

- [ ] Supported template status changes update local state.
- [ ] Relevant WABA/phone state changes update local state.
- [ ] Periodic reconciliation repairs missed webhook state.
- [ ] Replay/out-of-order tests pass.
- [ ] Operational failures surface in logs/metrics/alerts.

## [ ] PR-005 — Complete external Meta production prerequisites

**Tracking issue:** [#50](https://github.com/yasserfullstack-tech/whatsapp/issues/50)

**Suggested branch:** `docs/meta-production-evidence`

**Priority:** Launch blocker / external evidence

### Work

Track and attach evidence for the Meta-side prerequisites that cannot be proven from Git alone:

- App mode/status appropriate for production.
- Business verification if required for the selected Meta setup.
- Correct business messaging / Tech Provider setup if required.
- Required permissions and Advanced Access/App Review approval.
- Production webhook configuration.
- Production Embedded Signup configuration.
- Real WABA and phone-number onboarding test.

### Definition of done

- [ ] Required Meta approvals are confirmed.
- [ ] Production app/config IDs are documented securely (without committing secrets).
- [ ] Production webhook subscription is confirmed.
- [ ] Real onboarding test succeeds.
- [ ] Evidence is attached to the tracking issue/PR.

---

# Phase 2 — Billing and entitlement enforcement

## [ ] PR-006 — Implement the real billing provider

**Tracking issue:** [#51](https://github.com/yasserfullstack-tech/whatsapp/issues/51)

**Suggested branch:** `feat/billing-provider`

**Priority:** Launch blocker for paid launch

### Work

- Implement a concrete provider behind `packages/billing/src/provider.ts`.
- Customer creation.
- Checkout/session creation.
- Subscription activation.
- Upgrade/downgrade.
- Cancellation.
- Customer portal.
- Invoice/payment synchronization.
- Failed-payment handling.
- Refund support if required by product policy.
- Provider webhook signature verification.
- Webhook idempotency and replay handling.
- Append-only provider-event storage for troubleshooting/reconciliation.
- Replace disabled/non-functional upgrade controls in the billing UI.

### Definition of done

- [ ] Checkout works end to end.
- [ ] Subscription state is synchronized from provider webhooks.
- [ ] Upgrade/downgrade/cancel work.
- [ ] Billing portal works.
- [ ] Failed payment behavior is implemented.
- [ ] Webhook replay is safe.
- [ ] Automated integration tests cover the lifecycle.

## [ ] PR-007 — Enforce entitlements and usage limits server-side

**Tracking issue:** [#52](https://github.com/yasserfullstack-tech/whatsapp/issues/52)

**Suggested branch:** `feat/entitlement-enforcement`

**Priority:** Launch blocker for paid launch

### Work

Use the existing entitlement service and enforce limits at server boundaries for:

- Contacts.
- Members.
- Connected phone numbers.
- Import size.
- Monthly campaign recipients.
- Other plan-gated features.

Also:

- Define exactly when campaign-recipient usage becomes billable/countable.
- Record usage idempotently.
- Prevent client/UI bypass.
- Expose useful limit/usage errors.
- Reconcile usage where practical.

### Definition of done

- [ ] Server-side enforcement exists for every paid limit.
- [ ] Usage cannot be bypassed by direct API calls.
- [ ] Monthly usage accounting is idempotent.
- [ ] Upgrade immediately unlocks the new limits.
- [ ] Downgrade behavior is defined and tested.
- [ ] Limit tests exist for all enforced resources.

---

# Phase 3 — Legal and compliance

## [ ] PR-008 — Finalize legal documents and compliance procedures

**Tracking issue:** [#53](https://github.com/yasserfullstack-tech/whatsapp/issues/53)

**Suggested branch:** `docs/legal-and-compliance`

**Priority:** Launch blocker

### Work

Finalize with appropriate legal review:

- Legal entity details.
- Privacy Policy.
- Terms of Service.
- Acceptable-use / anti-spam rules.
- Data controller/processor responsibilities.
- DPA where applicable.
- Subprocessor list.
- Hosting/data-region disclosure.
- Data-retention policy.
- Privacy/support/abuse contacts.
- Payment, refund, dispute, and cancellation terms.
- Governing law and liability language.
- Legal-document versioning and acceptance recording.

Create operating procedures for:

- Abuse reports.
- Suppression/consent disputes.
- Data-subject/privacy requests.
- Data deletion.
- Customer suspension/reactivation.
- Meta quality/restriction escalation.

### Definition of done

- [ ] Placeholder legal text has been replaced.
- [ ] Required legal review/approval is recorded.
- [ ] Customer acceptance is versioned and stored.
- [ ] Privacy/abuse/support procedures have owners.
- [ ] Compliance runbooks are documented.

---

# Phase 4 — Production infrastructure and recovery

## [ ] PR-009 — Provision and validate staging/production infrastructure

**Tracking issue:** [#54](https://github.com/yasserfullstack-tech/whatsapp/issues/54)

**Suggested branch:** `ops/production-infrastructure`

**Priority:** Launch blocker / external evidence

### Work

Turn `docs/deployment.md` into a verified environment:

- Isolated staging.
- Isolated production.
- DNS.
- TLS.
- Host firewall.
- Production secrets.
- Immutable release image/versioning.
- PostgreSQL.
- Valkey.
- Worker processes.
- R2 production bucket/configuration.
- Email provider production configuration.
- Sentry production project/configuration.
- Meta production credentials/configuration.
- Rollback procedure.
- Smoke tests.

Do not share production databases, Valkey instances, storage credentials, or Meta assets with staging.

### Definition of done

- [ ] Staging deployment passes smoke tests.
- [ ] Production deployment passes smoke tests.
- [ ] DNS/TLS/firewall are verified.
- [ ] Secrets are not committed to Git.
- [ ] Release rollback has been rehearsed.
- [ ] Production evidence is attached.

## [ ] PR-010 — Activate and prove backup/recovery

**Tracking issue:** [#55](https://github.com/yasserfullstack-tech/whatsapp/issues/55)

**Suggested branch:** `ops/backup-recovery`

**Priority:** Launch blocker

### Work

Build on `docs/backups.md`:

- Schedule encrypted PostgreSQL backups.
- Store backups off-server.
- Define retention.
- Secure recovery keys separately from backups.
- Verify backup freshness automatically.
- Add R2/object-storage recovery/versioning strategy.
- Define RPO and RTO.
- Perform clean-host restore.
- Perform a documented recovery drill.

### Definition of done

- [ ] Scheduled backups are actually running.
- [ ] Off-server copies are verified.
- [ ] Backup-age monitoring exists.
- [ ] A clean restore has succeeded.
- [ ] R2 recovery/versioning is addressed.
- [ ] RPO/RTO are documented and accepted.
- [ ] Recovery-drill evidence is attached.

---

# Phase 5 — Monitoring, alerting, and incident response

## [ ] PR-011 — Add actionable production alerting

**Tracking issue:** [#56](https://github.com/yasserfullstack-tech/whatsapp/issues/56)

**Suggested branch:** `ops/production-alerting`

**Priority:** Launch blocker

### Work

Build on existing Prometheus/Grafana/Sentry observability.

Add alert rules/routing for at least:

- Web/API readiness failure.
- Worker down.
- Queue growth/stall.
- Dead-letter accumulation.
- Meta authentication failures.
- Meta rate limiting.
- Meta 5xx/errors.
- Webhook processing failure/lag.
- Campaign failure-rate spikes.
- PostgreSQL saturation/connectivity.
- Valkey availability/memory.
- Backup failure/stale backup.
- Disk pressure.
- TLS certificate expiry.
- R2 failures.
- Email provider failures.
- Sentry error-rate spikes.

Also:

- Define alert severities.
- Route alerts to a real operator/on-call destination.
- Link alerts to runbooks.
- Define a small set of SLIs/SLOs.

### Definition of done

- [ ] Alert rules are version-controlled.
- [ ] Alerts reach a human-operated destination.
- [ ] Test alerts have been triggered successfully.
- [ ] Every critical alert links to a runbook.
- [ ] Core SLIs/SLOs are documented.

---

# Phase 6 — Production validation and launch proof

## [ ] PR-012 — Real-provider production validation

**Tracking issue:** [#57](https://github.com/yasserfullstack-tech/whatsapp/issues/57)

**Suggested branch:** `test/production-provider-validation`

**Priority:** Launch blocker

### Work

Run and record real external-system tests for:

- Meta Embedded Signup.
- Real WhatsApp send.
- Delivery and read status processing.
- Deliberate send failure.
- Inbound message processing.
- Opt-out behavior.
- Credential invalidation/reconnect.
- Meta template/account synchronization.
- R2 upload/import.
- Email delivery.
- Full campaign dispatch.
- Workspace/account export if supported.
- Permanent workspace/account deletion.
- Billing lifecycle.
- Backup/restore.
- Release rollback.

### Definition of done

- [ ] Every required real-provider flow has passed.
- [ ] Failures and recovery paths have been tested.
- [ ] Evidence is stored with the release-readiness issue.
- [ ] No test relies only on fake Meta/provider implementations for launch approval.

## [ ] PR-013 — Representative load, soak, and recovery validation

**Tracking issue:** [#58](https://github.com/yasserfullstack-tech/whatsapp/issues/58)

**Suggested branch:** `test/production-scale-validation`

**Priority:** Launch blocker for any published scale claim

### Work

Build on `docs/stress-soak.md`.

- Run 1k, 10k, 50k, 100k, and relevant larger workloads as appropriate.
- Run the 500k profile only on infrastructure representative of the target production claim.
- Record machine sizes/configuration.
- Record PostgreSQL configuration.
- Record Valkey configuration.
- Record worker count/concurrency.
- Measure throughput/MPS.
- Measure queue depth and drain time.
- Measure memory/RSS.
- Measure DB connection behavior.
- Measure webhook latency.
- Record retries/failures.
- Run chaos/recovery tests.
- Run soak tests.

### Definition of done

- [ ] Representative-environment benchmark evidence exists.
- [ ] Correctness thresholds pass.
- [ ] Resource thresholds pass.
- [ ] Recovery behavior passes.
- [ ] Any public capacity claim is supported by evidence.

---

# Phase 7 — Inbound inbox

## [x] PR-014 — Build the inbound WhatsApp inbox

**Tracking issue:** [#59](https://github.com/yasserfullstack-tech/whatsapp/issues/59)

**Suggested branch:** `feat/inbound-inbox`

**Priority:** Product scope

### Work

- Conversation/thread model.
- Inbound/outbound message persistence.
- Meta message IDs and delivery state.
- Sender/recipient metadata.
- Message timestamps.
- Supported message/media content references.
- Unread state/counts.
- Conversation list.
- Thread view.
- Agent reply.
- Assignment.
- Open/closed state.
- Internal notes.
- Search/filtering.
- Relevant notifications.
- Permissions and tenant isolation.
- Keep campaign sends and agent replies distinct in the domain model.

### Definition of done

- [x] Inbound messages appear reliably in a conversation.
- [x] Agent replies send through Meta and update state.
- [x] Assignment/status/notes work.
- [x] Media behavior is defined and tested.
- [x] Tenant-isolation tests pass.
- [x] Webhook replay does not duplicate messages.

---

# Phase 8 — Rich templates and campaign automation

## [ ] PR-015 — Support rich WhatsApp templates

**Tracking issue:** [#60](https://github.com/yasserfullstack-tech/whatsapp/issues/60)

**Suggested branch:** `feat/rich-message-templates`

**Priority:** Product scope

### Work

Extend the current text-oriented template flow to support the Meta template structures the product intends to offer, including where applicable:

- Text headers.
- Image headers.
- Video headers.
- Document headers.
- Buttons.
- URL/phone/quick-reply actions.
- Authentication-template requirements if in scope.
- Structured component storage.
- Template preview.
- Campaign rendering/parameter mapping.
- Validation before send.

### Definition of done

- [ ] Supported rich templates can be created/imported.
- [ ] Template status synchronization works with rich templates.
- [ ] Campaigns can render/send supported components.
- [ ] Parameter validation prevents invalid sends.
- [ ] Automated tests cover supported component combinations.

## [ ] PR-016 — Campaign scheduling and automation foundation

**Tracking issue:** [#61](https://github.com/yasserfullstack-tech/whatsapp/issues/61)

**Suggested branch:** `feat/campaign-scheduling`

**Priority:** Product scope

### Work

- Accept and persist `scheduledAt`.
- Define organization/user timezone handling.
- Do not immediately dispatch scheduled campaigns.
- Add scheduler/dispatcher jobs.
- Define audience snapshot timing.
- Support cancellation before dispatch.
- Support rescheduling.
- Make scheduler execution idempotent.
- Add schedule status to UI.
- After one-time scheduling is stable, design recurring/drip/event-triggered automation as a separate subsystem rather than adding ad-hoc conditions to the campaign route.

### Definition of done

- [ ] Scheduled campaign does not dispatch early.
- [ ] Campaign dispatches at the expected time.
- [ ] Timezone behavior is tested.
- [ ] Cancel/reschedule are safe.
- [ ] Duplicate scheduler execution cannot duplicate campaign dispatch.

## [x] PR-017 — Implement real onboarding test mode

**Tracking issue:** [#62](https://github.com/yasserfullstack-tech/whatsapp/issues/62)

**Suggested branch:** `feat/onboarding-test-mode`

**Priority:** Product scope / launch UX

### Work

- Make `/campaigns?onboarding=test` a real mode instead of only linking to the normal builder.
- Clearly label the onboarding test experience.
- Enforce the advertised contact/test-recipient limit server-side.
- Prevent bypass through direct API requests.
- Mark onboarding complete only after a qualifying successful test.
- Surface useful failure/retry guidance.

### Definition of done

- [x] Test mode is visibly distinct.
- [x] Recipient limit is server-enforced.
- [x] Successful test updates onboarding state.
- [x] Failed test does not incorrectly complete onboarding.
- [x] Automated tests cover test-mode restrictions.

---

# Phase 9 — Contacts, notifications, and admin depth

## [ ] PR-018 — Complete contact management

**Tracking issue:** [#63](https://github.com/yasserfullstack-tech/whatsapp/issues/63)

**Suggested branch:** `feat/contact-management`

**Priority:** Product scope

### Work

Build on existing filtering and consent history:

- Manual create.
- Edit.
- Custom fields.
- Tags.
- Notes.
- Import mapping.
- Contact activity history beyond consent events.
- Bulk actions.
- Merge/deduplication.
- Scalable pagination.
- Permission enforcement.

### Definition of done

- [ ] Contacts can be created/edited manually.
- [ ] Custom fields/tags/notes work.
- [ ] Imports can map fields safely.
- [ ] Merge/deduplication is auditable.
- [ ] Bulk operations are safe and permission-checked.
- [ ] Large contact lists paginate efficiently.

## [ ] PR-019 — Wire the full notification catalog

**Tracking issue:** [#64](https://github.com/yasserfullstack-tech/whatsapp/issues/64)

**Suggested branch:** `feat/notification-runtime`

**Priority:** Product scope

### Work

Wire existing/needed notification definitions into runtime events for:

- Campaign success/failure.
- Import success/failure.
- Template approval/rejection.
- WhatsApp disconnect/reauthorization.
- WhatsApp quality changes.
- Billing/payment failures.
- Subscription changes.
- Usage/limit thresholds.
- Security/account changes.
- Inbound messages if inbox notifications are enabled.

### Definition of done

- [ ] Every supported notification has a real event source.
- [ ] Duplicate events do not spam users.
- [ ] Notification permissions/preferences are respected.
- [ ] Failure handling is observable.

## [ ] PR-020 — Expand platform admin tooling

**Tracking issue:** [#65](https://github.com/yasserfullstack-tech/whatsapp/issues/65)

**Suggested branch:** `feat/platform-admin-tools`

**Priority:** Product scope / operations

### Work

Build on existing organization suspension, user disable, and plan/limit controls:

- Platform-admin grant/revoke workflow with strong authorization.
- Subscription/billing visibility and controls.
- Invoice/payment visibility.
- Meta connection health and reconnect visibility.
- Queue/dead-letter visibility and safe retry tooling.
- Organization lifecycle tooling.
- Membership/role support tooling.
- Pagination/filtering/search.
- Audit export.
- Webhook/event visibility.

Keep user impersonation out unless/until a separate privileged-session threat model, audit model, elevation flow, and explicit product requirement are approved.

### Definition of done

- [ ] Admin actions are authorization-checked.
- [ ] Sensitive actions are audited.
- [ ] Operational troubleshooting no longer requires direct DB edits for normal cases.
- [ ] Queue/webhook/billing/Meta state is inspectable.
- [ ] Admin list views scale with pagination/filtering.

---

# Phase 10 — Security assurance

## [ ] PR-021 — Container and supply-chain security hardening

**Tracking issue:** [#66](https://github.com/yasserfullstack-tech/whatsapp/issues/66)

**Suggested branch:** `security/container-supply-chain`

**Priority:** Continuous / launch hardening

### Work

Keep existing Bun audit, Gitleaks, CodeQL, and security E2E checks. Add:

- Container/image vulnerability scanning.
- Severity policy for blocking releases.
- Image provenance/version traceability where practical.
- Frozen dependency install in CI if supported by the current Bun version/workflow.
- Fix the lockfile only if the frozen install actually reproduces a problem.

### Definition of done

- [ ] Production images are vulnerability-scanned in CI/release flow.
- [ ] Blocking severity policy is documented.
- [ ] Dependency installs are reproducible/frozen where supported.
- [ ] Existing security jobs remain green.

## [ ] PR-022 — Application security hardening and independent testing

**Tracking issue:** [#67](https://github.com/yasserfullstack-tech/whatsapp/issues/67)

**Suggested branch:** `security/application-hardening`

**Priority:** Continuous

### Work

- Expand IDOR/tenant-isolation coverage.
- Expand abuse/rate-limit tests.
- Add hostile/malformed object-storage integration tests.
- Document and test secret rotation.
- Design credential-encryption-key rotation with key/ciphertext versioning.
- Review PostgreSQL RLS as an optional defense-in-depth layer and document the decision.
- Review privileged admin operations.
- Run an independent penetration test before broader enterprise rollout.
- Track remediation findings to closure.

### Definition of done

- [ ] Expanded tenant-isolation tests pass.
- [ ] Rate-limit/abuse tests pass.
- [ ] Secret/key rotation procedure has been exercised.
- [ ] RLS decision is documented with rationale.
- [ ] Independent security review/pentest is complete when required for the release stage.
- [ ] Critical/high findings are remediated or formally accepted with rationale.

---

# Final paid-production launch gate

Do not mark the release production-ready until every launch-blocking item below is checked.

- [x] PR-001 Production readiness tracking ([#46](https://github.com/yasserfullstack-tech/whatsapp/issues/46))
- [ ] PR-002 Current Meta Embedded Signup migration ([#47](https://github.com/yasserfullstack-tech/whatsapp/issues/47))
- [ ] PR-003 Connection health and reauthorization ([#48](https://github.com/yasserfullstack-tech/whatsapp/issues/48))
- [ ] PR-004 Meta asset/account synchronization ([#49](https://github.com/yasserfullstack-tech/whatsapp/issues/49))
- [ ] PR-005 External Meta production prerequisites ([#50](https://github.com/yasserfullstack-tech/whatsapp/issues/50))
- [ ] PR-006 Real billing provider ([#51](https://github.com/yasserfullstack-tech/whatsapp/issues/51))
- [ ] PR-007 Server-side entitlement enforcement ([#52](https://github.com/yasserfullstack-tech/whatsapp/issues/52))
- [ ] PR-008 Final legal/compliance package ([#53](https://github.com/yasserfullstack-tech/whatsapp/issues/53))
- [ ] PR-009 Production infrastructure ([#54](https://github.com/yasserfullstack-tech/whatsapp/issues/54))
- [ ] PR-010 Backup/recovery proof ([#55](https://github.com/yasserfullstack-tech/whatsapp/issues/55))
- [ ] PR-011 Alerting/on-call readiness ([#56](https://github.com/yasserfullstack-tech/whatsapp/issues/56))
- [ ] PR-012 Real-provider validation ([#57](https://github.com/yasserfullstack-tech/whatsapp/issues/57))
- [ ] PR-013 Representative scale validation for any published capacity claim ([#58](https://github.com/yasserfullstack-tech/whatsapp/issues/58))

## Launch evidence required

Before checking the final release gate, attach or link evidence for:

- [ ] Real Meta onboarding.
- [ ] Real WhatsApp send + delivery/read status.
- [ ] Real inbound message/opt-out behavior.
- [ ] Credential failure + reconnect recovery.
- [ ] Meta template/account state synchronization.
- [ ] Billing checkout/subscription/payment lifecycle.
- [ ] Entitlement/usage enforcement.
- [ ] Production DNS/TLS/deployment.
- [ ] R2 production behavior.
- [ ] Email production delivery.
- [ ] Backup and clean restore.
- [ ] Rollback drill.
- [ ] Alert delivery to a human-operated destination.
- [ ] Representative load/soak test results supporting any published scale claim.
- [ ] Legal/compliance approval.

---

# Post-launch / product-completeness gate

These do not necessarily block the first paid launch unless they are explicitly promised in the launch scope.

- [x] PR-014 Inbound inbox ([#59](https://github.com/yasserfullstack-tech/whatsapp/issues/59))
- [ ] PR-015 Rich WhatsApp templates ([#60](https://github.com/yasserfullstack-tech/whatsapp/issues/60))
- [ ] PR-016 Campaign scheduling/automation foundation ([#61](https://github.com/yasserfullstack-tech/whatsapp/issues/61))
- [x] PR-017 Onboarding test mode ([#62](https://github.com/yasserfullstack-tech/whatsapp/issues/62))
- [ ] PR-018 Contact management depth ([#63](https://github.com/yasserfullstack-tech/whatsapp/issues/63))
- [ ] PR-019 Full notification runtime ([#64](https://github.com/yasserfullstack-tech/whatsapp/issues/64))
- [ ] PR-020 Expanded platform admin tooling ([#65](https://github.com/yasserfullstack-tech/whatsapp/issues/65))
- [ ] PR-021 Container/supply-chain hardening ([#66](https://github.com/yasserfullstack-tech/whatsapp/issues/66))
- [ ] PR-022 Application security hardening / independent testing ([#67](https://github.com/yasserfullstack-tech/whatsapp/issues/67))

---

# Completion rule

A checkbox in this file means **verified complete**, not merely "code written".

For engineering tasks, completion requires the implementation, automated tests, documentation, and passing CI.

For production/operations tasks, completion additionally requires evidence that the control is active in the real environment.

For external-provider/legal tasks, completion requires evidence from the relevant external system or responsible reviewer.
