# Real-provider production validation

This runbook is the repository-side execution guide for **PR-012 — Real-provider production validation** in `docs/production-readiness-plan.md` and issue #57.

PR-012 is a launch gate, not a synthetic CI suite. The release is not approved by this document, by local fake-provider tests, or by a green pull request alone. Sign-off requires dated evidence from the real external systems used by the target release.

## What must be recorded

Create a local evidence manifest from `infra/production/validation/provider-evidence.example.json`, fill it during the validation session, and keep it under `.runtime/provider-validation/` so it is not committed accidentally.

Every run must identify:

- environment (`staging` or `production`),
- execution timestamp,
- exact Git commit,
- immutable web/API/worker/migrator image digests,
- one result for every required flow below,
- sanitized evidence references,
- recovery results for the flows that intentionally exercise failure/recovery,
- a short rationale for the optional export flow when the product does not support export.

Validate the manifest before attaching any summary:

```sh
bun run validate:provider-evidence -- .runtime/provider-validation/release.json --require-pass --summary .runtime/provider-validation/release-summary.md
```

The validator rejects missing flows, incomplete release identity, unresolved required recovery paths, and common secret/PII patterns. It cannot prove that an attachment is safe; review screenshots/logs manually before uploading them.

## Required flows

| ID | Real-provider validation | Minimum pass evidence |
| --- | --- | --- |
| `meta_embedded_signup` | Complete current Embedded Signup with the configured Meta app/configuration. | Redacted Meta/app reference plus application audit/log reference proving the expected WABA and phone asset were connected. |
| `whatsapp_send` | Send through the real WhatsApp Cloud API. | Provider message identifier reference and local recipient/campaign state reference, without phone number or message body. |
| `delivery_read_status` | Observe delivered and read status webhooks and local monotonic state transitions. | Redacted webhook/audit/observability references for both transitions. |
| `deliberate_send_failure` | Trigger a controlled provider rejection and prove bounded failure handling. | Sanitized provider error class/code plus local terminal/retry state; recovery evidence must show a later successful send after the cause is removed. |
| `inbound_message` | Receive a real inbound WhatsApp message and project it into the inbox. | Redacted provider/webhook reference and inbox record/audit reference. Do not include message content. |
| `opt_out` | Exercise the supported opt-out path and prove future campaign sends are suppressed. | Consent/suppression audit reference plus a blocked/omitted send reference. |
| `credential_invalidation_reconnect` | Invalidate or revoke the test credential, prove sends are blocked, then reconnect. | Connection-health transition references and a successful post-reconnect provider call. |
| `meta_asset_sync` | Exercise a real template/phone/account state change or reconciliation repair. | Redacted Meta asset reference and local reconciliation/audit reference. |
| `r2_upload_import` | Upload/import through the configured production R2-compatible provider. | Object/import job references and final import result; never attach credentials or object contents containing customer data. |
| `email_delivery` | Deliver through the configured external email provider. | Provider delivery/message reference and application notification/delivery reference, with recipient address removed. |
| `full_campaign_dispatch` | Dispatch a complete campaign through the real worker/provider path. | Campaign/job/queue observability references and provider delivery totals. |
| `account_export` | Run workspace/account export when the product supports it. | Export job/object reference and access-control/audit evidence. If export is not supported, mark `not_applicable` with the product-scope reason. |
| `account_deletion` | Permanently delete a controlled test workspace/account through the supported path. | Audit reference plus verification that tenant data/credentials are no longer accessible. Never use a customer workspace. |
| `billing_lifecycle` | Exercise the selected billing provider's sandbox/test lifecycle end to end. | Checkout/subscription/invoice/payment/webhook references covering activation, plan change, failed-payment recovery, cancellation, replay safety, and refund when applicable. |
| `backup_restore` | Restore from the real off-server encrypted backup path using the recovery drill. | Recovery-drill evidence with backup identity, checksum result, restore result, and measured recovery duration. |
| `release_rollback` | Roll back to the previous immutable release and pass smoke tests. | Before/after release manifest references, rollback command/result, and successful public smoke-test reference. |

## Execution order

1. Freeze the candidate release and record its commit and immutable image digests before testing.
2. Confirm the validation workspace/accounts contain no customer data and are dedicated to release verification.
3. Run the Meta/WhatsApp flows first: onboarding, send, status, controlled failure, inbound, opt-out, credential recovery, and asset sync.
4. Run R2 and email provider validation.
5. Run a complete campaign using the same workers/queues/provider configuration intended for launch.
6. Run supported export and permanent deletion only against the controlled validation workspace.
7. Run the complete billing lifecycle against the configured provider test mode or approved launch-validation account.
8. Run backup/restore and release rollback using the production operations runbooks.
9. Complete the evidence manifest, validate it with `--require-pass`, generate the Markdown summary, and manually review every referenced attachment for secrets/PII.
10. Attach the sanitized summary and external references to issue #57. Keep raw provider payloads, credentials, phone numbers, message bodies, customer identifiers, database dumps, and private logs outside GitHub.

## Failure and recovery expectations

A test failure is useful evidence but is not a launch pass. Record the failure, remediate it, and rerun the affected flow on the same release or record the new release identity if code/configuration changed.

The manifest requires explicit recovery proof for controlled send failure, credential invalidation/reconnect, billing lifecycle failure recovery, backup/restore, and release rollback. Other flows should also include recovery evidence whenever the test encounters a failure.

If a remediation changes application code, image digest, provider configuration, database schema, or launch-significant infrastructure, begin a new evidence manifest for the new candidate release rather than editing the old run into a pass.

## Redaction rules

Do not put any of the following in the manifest, generated summary, issue comment, PR, or screenshots/log extracts attached to GitHub:

- access/refresh tokens, app secrets, webhook secrets, passwords, private keys, authorization codes, or signing keys,
- WhatsApp phone numbers, email addresses, customer names, message bodies, media contents, or customer payloads,
- Billing-provider credentials/webhook secrets, R2 access keys, database URLs/credentials, backup encryption keys, or decrypted backup data.

Use stable references instead: GitHub Actions run IDs, Sentry event IDs without user data, provider dashboard event IDs, application audit IDs, queue/job IDs, campaign IDs, release manifest hashes, and redacted screenshots.

## Launch sign-off

PR-012 in `docs/production-readiness-plan.md` and issue #57 remain open until the validated summary shows every required real-provider flow passed (or the explicitly optional export flow is documented as unsupported), required recovery paths passed, and the evidence has been reviewed. Synthetic/fake-provider CI remains valuable regression coverage but cannot substitute for this gate.
