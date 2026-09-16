# Meta asset and account synchronization

PR-004 keeps local WhatsApp templates, business phone metadata, quality state, and important WABA account state aligned with Meta. The implementation deliberately uses both webhooks and periodic API reconciliation: webhook delivery is fast but not treated as the only source of truth.

## Provider events and API evidence

The supported webhook fields and local effects are:

| Meta field | Local behavior | Provider reference |
| --- | --- | --- |
| `message_template_status_update` | Updates `templates.status`, `meta_status`, rejection reason, and `last_synced_at`. Provider event time/fingerprint prevents replay or older events from regressing state. | [Meta webhook reference](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/message_template_status_update) |
| `phone_number_name_update` | Persists an approved requested verified name/display number and audits approved/rejected decisions. | [Meta webhook reference](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/phone_number_name_update) |
| `phone_number_quality_update` | Triggers an authoritative phone-number API read so the stored quality rating and throughput reflect current provider state rather than inferring a rating from the webhook event name. | [Meta webhook reference](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/phone_number_quality_update) |
| `account_update` | Persists WABA restriction transitions on all local phone records when Meta reports flagged/disabled/reinstated ban state, and records an audit event. | [Meta webhook reference](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/account_update) |
| `account_review_update` | Records the review decision as an auditable WABA state change without treating business review rejection as a messaging restriction by itself. | [Meta webhook reference](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/account_review_update) |

Meta's official WhatsApp Business Platform collection documents the Embedded Signup webhook envelope and these event families, including phone name/quality, account, review, and template status updates: [Webhook components](https://www.postman.com/meta/whatsapp-business-platform/request/j09tht8/components). Meta's phone-number API returns the verified name, display phone number, ID, and quality rating used by reconciliation: [Get Phone Number By ID](https://www.postman.com/meta/whatsapp-business-platform/request/li0unxe/get-phone-number-by-id). Template reconciliation uses Meta's message-template listing API: [Templates](https://www.postman.com/meta/whatsapp-business-platform/folder/lczy75a/templates).

## Processing model

The existing durable `webhook_events` inbox remains responsible for signature-verified ingestion and normal message/status processing. The worker's Meta asset runtime scans successfully ingested webhook rows and creates a `meta_asset_webhook_receipts` row for independent retry/dead-letter state. This prevents an asset synchronization failure from corrupting or replaying message-delivery processing.

`meta_asset_state_versions` stores a provider observation timestamp and deterministic fingerprint per resource/state family. A webhook older than the stored provider time is ignored. An exact replay at the same time with the same fingerprint is ignored. Reconciliation writes a new observation watermark, so a webhook delayed until after reconciliation cannot restore stale provider state.

Asset webhook retries use bounded exponential backoff and move to `dead_letter` after 12 failed attempts. The scanner also reclaims a stale `processing` receipt after five minutes, making worker termination/restart recoverable.

## Periodic reconciliation

Every 15 minutes, each non-disconnected phone number is read from Meta using its encrypted credential. The worker refreshes:

- display phone number;
- verified name;
- quality rating;
- throughput level (mapped to the local messages-per-second limit).

For each distinct organization/WABA, all message templates are listed and upserted with current provider status, category, components, rejection reason, and synchronization timestamp. The reconciliation observation updates the same state-version watermarks used by webhooks.

The reconciliation path intentionally does not clear a stored WABA restriction merely because the phone-number API is readable. Restriction recovery is applied only when Meta reports a corresponding account transition such as reinstatement.

## Audit trail

Important provider-driven changes are written to `platform_audit_events` with a null actor and the organization/resource identifiers. Actions include template lifecycle changes, phone name/quality reconciliation, WABA account transitions, and account-review decisions. Secrets and access tokens are never copied into audit metadata.

## Metrics

The worker exposes these metrics through the existing shared metrics registry:

- `whatsapp_meta_asset_webhook_events_total{outcome=...}`;
- `whatsapp_meta_asset_sync_failures_total{operation=...}`;
- `whatsapp_meta_asset_dead_letter_events`;
- `whatsapp_meta_asset_reconciliation_total{outcome=...}`;
- `whatsapp_meta_asset_reconciliation_last_success_timestamp_seconds`;
- `whatsapp_meta_asset_reconciliation_duration_seconds`.

Meta HTTP failures continue to feed the existing `whatsapp_meta_errors_total` / `whatsapp_meta_429_total` metrics from `@wa/meta`.

## Alerts and recovery

`infra/production/alerts/meta-assets.rules.yml` alerts when asset webhook dead letters exist, synchronization failures are sustained, or reconciliation has not succeeded for 30 minutes.

For a webhook failure, inspect the worker log event `meta_asset_webhook_processing_failed`, the associated `webhook_events` row, and `meta_asset_webhook_receipts.last_error`. Fix the credential/data/provider issue and move the receipt from `dead_letter` to `retry` with `next_retry_at = now()` only after the root cause is understood. The scanner will reclaim it.

For stale reconciliation, inspect `meta_asset_reconciliation_failed` and the Meta API error metrics first. Authentication/permission errors should be resolved through the token lifecycle/re-authorization path rather than by replacing encrypted credential rows manually.

## Automated evidence

`packages/meta/src/webhooks.test.ts` covers parsing template, phone name, phone quality, account update, and account review payloads. `apps/worker/src/meta-assets.test.ts` covers exact replay suppression, older-event rejection, same-timestamp state transitions, template/account normalization, phone matching normalization, and provider timestamp fallback.

CI should run the repository-wide `bun test`, `bun run typecheck`, and database migration verification before merge.

## Staging evidence required before closing PR-004

The production-readiness tracking item should remain open until a redacted staging run proves at least one real Meta provider state transition or reconciliation repair. Capture the relevant webhook/API event, resulting local state, audit record, and successful reconciliation metric without exposing access tokens, business secrets, or customer message content.
