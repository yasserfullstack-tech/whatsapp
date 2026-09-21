# Notification runtime

PR-019 makes the notification catalog event-driven from durable product state instead of relying on UI-side calls.

## Sources

The machine-readable version of this table lives in `packages/notifications/src/event-sources.ts`
(`NOTIFICATION_EVENT_SOURCES`). `packages/notifications/src/event-sources.test.ts` fails when a
catalog type has no declared source, when a declared emitter file or anchor disappears, or when a
source claims durable reconciliation that `reconcileNotificationSources` no longer performs.

| Notification | Durable source | Emitter | Recipient scope |
| --- | --- | --- | --- |
| Campaign completed / failed | `campaigns.status` terminal state plus the BullMQ campaign-dispatch completion/failure event | `apps/worker/src/notification-runtime.ts` (queue hook) and `emitCampaignTerminalStates` in `apps/worker/src/notification-sources.ts` (durable replay) | Workspace members, filtered by preferences |
| Import completed | `contact_imports.status` = completed plus the BullMQ contact-import completion event | `apps/worker/src/notification-runtime.ts` (queue hook) and `emitImportCompletionStates` in `apps/worker/src/notification-sources.ts` (durable replay) | Workspace members, filtered by preferences |
| Import failed | `contact_imports.status` = failed once the contact-import queue has exhausted its attempts | `apps/worker/src/notification-runtime.ts` only; the hook checks `attemptsMade >= attempts` | Workspace members, filtered by preferences |
| Template approved / rejected | `platform_audit_events` written by Meta webhook/reconciliation state changes | `emitPlatformAuditEvents` in `apps/worker/src/notification-sources.ts` | Workspace members, filtered by preferences |
| WhatsApp disconnected | `workspace_audit_logs` written by the disconnect mutation | `emitWorkspaceAuditEvents` in `apps/worker/src/notification-sources.ts` | Owners/admins; mandatory |
| WhatsApp reauthorization / connection problem | Connection-health transition and restricted-WABA audit event | `notifyWorkspaceAdmins` in `apps/worker/src/connection-health.ts` and `emitPlatformAuditEvents` in `apps/worker/src/notification-sources.ts` | Owners/admins; mandatory |
| Quality rating degraded | Meta phone-quality reconciliation audit event | `emitPlatformAuditEvents` in `apps/worker/src/notification-sources.ts` | Owners/admins, filtered by preferences |
| Billing payment failed | Processed `billing_provider_events` for `invoice.payment_failed` | `emitPaymentFailures` in `apps/worker/src/notification-sources.ts` | Owners/admins; mandatory |
| Subscription past due | `billing_subscription_changes` to `past_due` or `grace_period` | `emitSubscriptionChanges` in `apps/worker/src/notification-sources.ts` | Owners/admins; mandatory |
| Other subscription changes | `billing_subscription_changes` | `emitSubscriptionChanges` in `apps/worker/src/notification-sources.ts` | Owners/admins, filtered by preferences |
| Usage approaching limit | Updated `billing_period_usage` at or above 80% of a finite entitlement | `emitUsageThresholds` in `apps/worker/src/notification-sources.ts` | Workspace members, filtered by preferences |
| Security/account change | Workspace security audit rows, including password/email/session/MFA and privileged membership/ownership mutations | `emitWorkspaceAuditEvents` in `apps/worker/src/notification-sources.ts` | Affected user or owners/admins; mandatory |
| Inbound WhatsApp message | Successfully persisted inbound `inbox_messages` row | `emitInboundNotification` in `apps/worker/src/inbox.ts` | Workspace members who explicitly opted in |

Team invitation delivery is a separate transactional invitation email and is not part of the configurable notification catalog because the invitee is not a workspace member until acceptance.

Inbound-message notifications are the only catalog entry without a durable reconciliation pass: they are emitted inline from the webhook projection that inserts the `inbox_messages` row, and the webhook event itself is retried until the row is durably projected.

Import failures are deliberately not replayed. `processContactImport` writes `status = "failed"` before rethrowing on *every* attempt, so a failed row is not terminal while the contact-import queue still has retries left (4 attempts with backoff). A scan cannot tell a transient failure write from a terminal one, so `import_failed` is emitted only by the queue hook, which compares `attemptsMade` against `attempts`. Replaying a transient row would announce a failure that a later retry turns into a success.

### Reconciliation cursor and window

The durable pass stores its last successful scan start in Valkey under
`notification:sources:cursor:v1`. On every pass it rereads a two-minute overlap
(`SOURCE_REPLAY_OVERLAP_MS`) before that persisted cursor, so deployment/restart
gaps longer than two minutes no longer drop durable source events.

The cursor advances only after every source reconciler succeeds. If the pass
throws or the worker exits before the cursor write, the previous cursor is kept
and the next pass safely replays the same range through stable dedupe keys.

When the key is missing or malformed (for example on the first deployment of
this control), the worker uses a bounded 24-hour bootstrap lookback
(`SOURCE_CURSOR_BOOTSTRAP_LOOKBACK_MS`) plus the normal overlap. This recovers a
reasonable outage/deployment window without doing an unbounded historical
backfill that could surface very old notifications.

## Replay and deduplication

`NotificationService` uses the durable source identity as `dedupe_key`. The database unique constraint on `(organization_id, user_id, dedupe_key)` is the final duplicate barrier.

The worker intentionally rereads a short overlap window for audit/billing sources. This makes process restarts and scan-boundary races safe: a source event may be inspected more than once, but the same user cannot receive a second notification for the same event.

Campaign terminal notifications are emitted by the BullMQ completion/failure hook and by the same durable reconciliation pass that covers audit/billing sources. Both paths build the same stable key, so a queue event that is missed while the notification worker is restarting is replayed exactly once by the next scan, within the reconciliation window described above. Import completions replay the same way; import failures do not replay, for the reason given above.

Examples:

- `platform-audit:<audit-id>`
- `workspace-audit:<audit-id>`
- `billing-provider:<provider-event-id>`
- `subscription-change:<change-id>`
- `usage-threshold:<period-usage-id>:80`
- `inbox:<wamid>`
- `campaign:<campaign-id>:<terminal-status>`
- `import:<import-id>:<terminal-status>`

## Preferences and mandatory events

Non-critical notification channels use each user's `notification_preferences` row. Missing preferences preserve the existing enabled-by-default behavior except for `inbound_message`, which is explicitly opt-in and therefore defaults to both in-app and email disabled.

The following events cannot be disabled because they can affect account access, delivery capability, or billing state:

- WhatsApp disconnect / connection problem
- billing payment failure
- past-due subscription
- security/account change

Suppressed channels are persisted as `notification_deliveries.status = suppressed`, so preference enforcement is auditable. The notification center only displays in-app deliveries with status `sent`.

## Delivery failure handling

Email delivery is durable in `notification_deliveries`. Provider attempts update attempt count, retry time, failure text, and terminal/dead-letter state. The notification worker logs queue failures and periodically reconciles pending email deliveries, so a successful notification insert is not lost if queue publication fails.

Durable source reconciliation also logs failures and only advances its persisted Valkey cursor after a successful pass. A failed pass is replayed on the next run with the same stable dedupe keys.

## Operational checks

For staging/production validation, exercise at least one event from each source family and verify:

1. the source state/audit row is committed first;
2. the expected recipients receive exactly one in-app/email delivery according to policy;
3. replaying/reprocessing the same source does not create a duplicate;
4. disabling a non-critical preference creates a suppressed delivery rather than a visible notification;
5. inbound-message notifications remain absent until explicitly enabled;
6. a forced email-provider failure is visible in delivery status/logging and can be retried by reconciliation.
