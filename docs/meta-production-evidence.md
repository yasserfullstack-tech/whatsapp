# Meta real-environment validation evidence

This document is the coordinated evidence runbook for the external Meta gates in
`docs/production-readiness-plan.md`:

- **PR-002 / #47** — current Embedded Signup flow and real onboarding;
- **PR-003 / #48** — broken-credential detection and safe reauthorization;
- **PR-004 / #49** — real Meta asset/account state synchronization;
- **PR-005 / #50** — production Meta app/business prerequisites.

These are **external-evidence launch gates**. Repository configuration, tests, or
documentation are not sufficient proof that the Meta-side state is active.
Keep each corresponding readiness checkbox unchecked until its required
real-environment evidence is attached to the tracking issue and reviewed.

The implementation baselines already merged to `main` are:

- PR-002: #70, merge commit `3ea70b038c30810a3f7d48871220070c5e297b16`;
- PR-003: #79, merge commit `3707022761cd0fe3f5970b178ddb49488ebbfc75`;
- PR-004: #78, merge commit `ed1f803e9b525447f57ae823693fb1d9e53b9e4d`;
- PR-005 evidence controls: #69, merge commit `e5eb7b743c66bf937a08f485aa1436c639dcaf87`.

Always record the **actual deployed release commit** used for the validation
session; the implementation commits above are provenance, not a substitute for
testing the deployed release.

## Current Meta references

Verified 2026-09-21 against Meta's official WhatsApp Business Platform Postman
collection:

- Embedded Signup overview / required onboarding endpoints:
  https://www.postman.com/meta/whatsapp-business-platform/documentation/du6gzjv/embedded-signup
- Embedded Signup step 1 / embedding the signup flow:
  https://www.postman.com/meta/whatsapp-business-platform/folder/b1a1oq8/step-1-embed-the-signup-flow
- Webhook component/event families:
  https://www.postman.com/meta/whatsapp-business-platform/request/j09tht8/components
- WhatsApp Cloud API permissions:
  https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api

Meta's current collection documents `whatsapp_business_management` and
`whatsapp_business_messaging` as the core WhatsApp permissions, with
`business_management` needed for business-portfolio operations used by some
Embedded Signup / Tech Provider flows. Validate the exact Advanced Access/App
Review state required by the selected production integration model rather than
assuming a development token proves production access.

## Coordinated validation session for #47–#50

Use a dedicated Meta test/staging business, WABA, and phone-number asset whenever
possible. Do not deliberately break credentials or create provider-state churn
on an active customer production asset merely to collect evidence.

Run the session in this order so the same evidence can satisfy multiple issues:

1. **Preflight / release traceability**
   - record date/time, environment, deployed release commit and verifier;
   - verify the deployment points at the intended production/staging
     `META_APP_ID` and `META_CONFIG_ID` in the approved secret/config store;
   - confirm no token/secret value will be copied into screenshots, logs or issue comments.
2. **Meta app/configuration prerequisites (#50, feeds #47)**
   - capture redacted app mode/status, applicable business/provider verification,
     required permission/App Review/Advanced Access state, Embedded Signup
     configuration, and webhook/WABA subscription state;
   - confirm the deployed `META_CONFIG_ID` corresponds to the configuration
     being shown, using a secure internal reference rather than pasting the ID.
3. **Real Embedded Signup onboarding (#47, also #50)**
   - onboard the dedicated test business/WABA through the deployed application;
   - verify the server-side code exchange completes;
   - verify the WABA is subscribed and the expected phone-number asset appears
     locally;
   - capture only redacted IDs or internal evidence references.
4. **Connection-health / reauthorization exercise (#48)**
   - on the dedicated staging/test asset, create a controlled unusable-credential
     condition using the Meta-side test/admin mechanism appropriate to the account
     (for example revoking/removing the test app authorization);
   - verify the application moves the connection to
     `reauthorization_required`, blocks unsafe sends, and does not enter an
     uncontrolled retry loop;
   - run the normal reconnect/Embedded Signup flow;
   - verify the connection returns to `healthy`, the safe failure state clears,
     and credential metadata/version changes without exposing token material.
5. **Real provider state synchronization (#49)**
   - use a low-risk provider state transition on the test WABA. The preferred
     path is a dedicated test message-template lifecycle change because its
     provider state is observable without affecting customer traffic;
   - capture the provider state/time, resulting local template/account state,
     corresponding audit record, and successful webhook or reconciliation
     evidence;
   - if the webhook is intentionally not used for the test, prove that periodic
     reconciliation repairs the local state instead.
6. **Final review**
   - map every artifact/reference to #47, #48, #49 and #50;
   - verify screenshots/comments contain no access token, OAuth code, app secret,
     verify token, customer phone number, raw webhook payload or customer PII;
   - close only the issue(s) whose complete evidence requirements are satisfied.

### Cross-issue evidence matrix

| Issue | Real-environment proof required | Can share evidence with |
| --- | --- | --- |
| #47 / PR-002 | Current Embedded Signup configuration + successful real test-business onboarding | #50 |
| #48 / PR-003 | Real broken-credential detection + safe reconnect restoring healthy state | #47, #50 |
| #49 / PR-004 | At least one real Meta state transition or reconciliation repair reflected locally and audited | #50, #57 |
| #50 / PR-005 | App/business prerequisites, permissions/access, webhook subscription, Embedded Signup configuration, real WABA + phone onboarding, release traceability | #47, #49, #57 |


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

## Issue-specific evidence records

Use the following minimal records after the coordinated session. A single
redacted attachment/reference can be linked from more than one issue when it
actually proves both requirements.

### #47 / PR-002

```text
PR-002 real Embedded Signup verification

Date/time:
Environment:
Tested release commit:
Verifier:

Current Embedded Signup configuration verified: YES
Required permission/access state verified: YES
Real test-business/WABA onboarding completed: YES
Phone-number asset synchronized locally: YES
Evidence references:
Secrets/customer data reviewed and redacted: YES
Remaining blockers: none / <list>
```

### #48 / PR-003

```text
PR-003 real reauthorization verification

Date/time:
Environment:
Tested release commit:
Verifier:

Controlled unusable-credential condition observed: YES
Application state became reauthorization_required: YES
Unsafe sends blocked / no uncontrolled retry loop: YES
Normal reconnect flow completed: YES
Application state returned to healthy: YES
Credential metadata/version changed without token exposure: YES
Evidence references:
Secrets/customer data reviewed and redacted: YES
Remaining blockers: none / <list>
```

### #49 / PR-004

```text
PR-004 real Meta state synchronization verification

Date/time:
Environment:
Tested release commit:
Verifier:

Provider state transition/reconciliation case:
Provider timestamp/reference:
Local state updated correctly: YES
Audit record present: YES
Webhook or reconciliation success evidence:
No credential/customer message content exposed: YES
Evidence references:
Remaining blockers: none / <list>
```

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
