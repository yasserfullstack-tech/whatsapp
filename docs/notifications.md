# Notification runtime

PR-019 makes the notification catalog event-driven from durable product state instead of relying on UI-side calls.

## Sources

| Notification | Durable source | Recipient scope |
| --- | --- | --- |
| Campaign completed / failed | Campaign dispatcher terminal state plus BullMQ completion/failure event | Workspace members, filtered by preferences |
| Import completed / failed | Contact-import terminal state plus BullMQ completion/failure event | Workspace members, filtered by preferences |
| Template approved / rejected | `platform_audit_events` written by Meta webhook/reconciliation state changes | Workspace members, filtered by preferences |
| WhatsApp disconnected | `workspace_audit_logs` written by the disconnect mutation | Owners/admins; mandatory |
| WhatsApp reauthorization / connection problem | Connection-health transition and restricted-WABA audit event | Owners/admins; mandatory |
| Quality rating degraded | Meta phone-quality reconciliation audit event | Owners/admins, filtered by preferences |
| Billing payment failed | Processed `billing_provider_events` for `invoice.payment_failed` | Owners/admins; mandatory |
| Subscription past due | `billing_subscription_changes` to `past_due` or `grace_period` | Owners/admins; mandatory |
| Other subscription changes | `billing_subscription_changes` | Owners/admins, filtered by preferences |
| Usage approaching limit | Updated `billing_period_usage` at or above 80% of a finite entitlement | Workspace members, filtered by preferences |
| Security/account change | Workspace security audit rows, including password/email/session/MFA and privileged membership/ownership mutations | Affected user or owners/admins; mandatory |
| Inbound WhatsApp message | Successfully persisted inbound `inbox_messages` row | Workspace members who explicitly opted in |

Team invitation delivery is a separate transactional invitation email and is not part of the configurable notification catalog because the invitee is not a workspace member until acceptance.

## Replay and deduplication

`NotificationService` uses the durable source identity as `dedupe_key`. The database unique constraint on `(organization_id, user_id, dedupe_key)` is the final duplicate barrier.

The worker intentionally rereads a short overlap window for audit/billing sources. This makes process restarts and scan-boundary races safe: a source event may be inspected more than once, but the same user cannot receive a second notification for the same event.

Examples:

- `platform-audit:<audit-id>`
- `workspace-audit:<audit-id>`
- `billing-provider:<provider-event-id>`
- `subscription-change:<change-id>`
- `usage-threshold:<period-usage-id>:80`
- `inbox:<wamid>`

Campaign and import terminal notifications retain their existing stable state keys.

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

Durable source reconciliation also logs failures and only advances its scan anchor after a successful pass. A failed pass is replayed on the next run with the same stable dedupe keys.

## Operational checks

For staging/production validation, exercise at least one event from each source family and verify:

1. the source state/audit row is committed first;
2. the expected recipients receive exactly one in-app/email delivery according to policy;
3. replaying/reprocessing the same source does not create a duplicate;
4. disabling a non-critical preference creates a suppressed delivery rather than a visible notification;
5. inbound-message notifications remain absent until explicitly enabled;
6. a forced email-provider failure is visible in delivery status/logging and can be retried by reconciliation.
