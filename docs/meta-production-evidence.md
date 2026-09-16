# Meta production prerequisite evidence

This document is the evidence runbook for **PR-005 — Complete external Meta production prerequisites** in `docs/production-readiness-plan.md` and tracking issue #50.

PR-005 is an **external-evidence launch gate**. Repository configuration, tests, or documentation are not sufficient proof that the Meta-side production prerequisites are active. Keep PR-005 unchecked until every required item below is verified against the production Meta app/business configuration and the evidence is attached to issue #50 or the related pull request.

## Evidence handling rules

Never commit or paste any of the following into Git, pull requests, issue comments, CI logs, or screenshots:

- Meta access tokens,
- `META_APP_SECRET`,
- `META_VERIFY_TOKEN`,
- customer phone numbers,
- customer business data or raw webhook payloads,
- session cookies, authorization codes, or other credentials.

Redact unrelated account identifiers and personal data from screenshots. Prefer screenshots that show only the status/configuration needed for the acceptance criterion.

The production deployment already expects these Meta configuration keys:

- `META_APP_ID` — environment-specific identifier; document the authoritative storage location, not a secret value in Git.
- `META_CONFIG_ID` — environment-specific Embedded Signup configuration identifier; document the authoritative storage location, not a secret value in Git.
- `META_APP_SECRET` — secret; secret-manager/host configuration only.
- `META_VERIFY_TOKEN` — secret; secret-manager/host configuration only.

A populated `.env.production` must remain outside Git as described in `docs/secrets.md`.

## Verification record

Create one evidence entry per verification run. Do not mark an item verified from memory or from a repository configuration placeholder.

Record:

- verification date/time,
- environment (`production`),
- release commit SHA being tested,
- Meta app identifier only in an approved secure evidence location,
- Embedded Signup configuration identifier only in an approved secure evidence location,
- verifier/owner,
- evidence attachment names or secure references,
- result and any remediation notes.

### Gate checklist

| Requirement | Required evidence | Status |
| --- | --- | --- |
| Production app mode/status | Redacted Meta dashboard evidence showing the app is in the production-appropriate mode/state | Pending |
| Business verification, when required by the selected setup | Redacted verification/status evidence or a note documenting why Meta does not require it for this production setup | Pending |
| Business messaging / Tech Provider setup, when required | Redacted Meta account/provider status evidence or documented not-applicable determination based on the selected integration model | Pending |
| Required permissions and Advanced Access/App Review | Redacted permission/App Review evidence showing the production app has the access needed by the implemented flow | Pending |
| Production webhook configuration | Redacted callback/subscription evidence plus a successful production webhook delivery/subscription check | Pending |
| Production Embedded Signup configuration | Redacted configuration evidence showing the production configuration used by the deployed application | Pending |
| Real WABA onboarding | Evidence that a real production/test business WABA completed the supported onboarding flow | Pending |
| Real phone-number onboarding | Evidence that the expected phone-number asset was connected and synchronized without exposing the number publicly | Pending |
| Release traceability | Verification date, environment, and tested release commit recorded with the evidence | Pending |

## Verification procedure

### 1. Production app and business status

In Meta's production business/app administration surfaces, verify the app is in the mode/state intended for real customer onboarding. Verify business verification and the selected business messaging / provider setup when Meta requires them for this integration model.

Capture only the relevant status area. Redact unrelated business identifiers and people.

### 2. Permissions and access review

Verify the production app has the permissions/access required by the actual application flow. For the current repository plan, this includes confirming the WhatsApp business-management and messaging access required by the implementation and any corresponding Advanced Access/App Review state.

Evidence must show the granted production state, not merely a requested or development-only permission.

### 3. Embedded Signup production configuration

Verify that the production Embedded Signup/Facebook Login for Business configuration is the one referenced by the deployed `META_CONFIG_ID`.

Do not put the production ID value in this file. Record where operators can retrieve the approved identifier securely, for example the deployment secret/configuration store entry named `META_CONFIG_ID`.

PR-005's final onboarding evidence should be collected after PR-002's current Embedded Signup implementation is available, because a successful legacy or superseded flow does not prove the intended production configuration.

### 4. Webhook configuration and subscription

Verify the production callback endpoint and WABA/app subscription are configured for the production environment. Confirm the endpoint can complete verification and that a real supported event reaches the production webhook path successfully.

Do not attach the verify token or raw customer webhook payload. Evidence should show subscription/configuration state and a sanitized operational proof such as timestamp, event category, request/result correlation, and success status.

Coordinate this evidence with PR-004 and PR-012 so the same production event can also prove local synchronization/reliability where appropriate.

### 5. Real WABA and phone-number onboarding

Run the supported onboarding flow with a real Meta business/WABA and an allowed phone-number asset. Confirm that:

- Embedded Signup completes successfully,
- the server-side authorization/code exchange succeeds,
- the WABA is subscribed/configured as expected,
- the phone-number asset is synchronized into the application,
- no secret or customer data is exposed in the evidence.

Record only a redacted identifier or evidence reference sufficient to correlate the test internally.

### 6. Final evidence review

Before closing issue #50 or marking PR-005 complete, verify that every row in the gate checklist has evidence or an explicit, justified not-applicable determination. The evidence set must include the verification date, production environment, and tested release commit.

## Evidence comment template

Use this structure when attaching the final proof to issue #50 or the PR:

```text
PR-005 Meta production verification

Date/time:
Environment: production
Tested release commit:
Verifier:

- Production app mode/status: VERIFIED — evidence: <attachment/reference>
- Business verification: VERIFIED / NOT APPLICABLE — evidence/rationale: <attachment/reference>
- Business messaging / Tech Provider setup: VERIFIED / NOT APPLICABLE — evidence/rationale: <attachment/reference>
- Required permissions / Advanced Access / App Review: VERIFIED — evidence: <attachment/reference>
- Production webhook configuration/subscription: VERIFIED — evidence: <attachment/reference>
- Production Embedded Signup configuration: VERIFIED — evidence: <attachment/reference>
- Real WABA onboarding: VERIFIED — evidence: <attachment/reference>
- Real phone-number onboarding/sync: VERIFIED — evidence: <attachment/reference>

Secrets/customer data reviewed and redacted: YES
Remaining blockers: none / <list>
```

## Completion rule

PR-005 remains incomplete while any required evidence is missing. A documentation-only PR that adds this runbook does **not** satisfy the launch gate by itself.
