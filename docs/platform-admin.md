# Platform administration

The platform control plane is intentionally separate from workspace authorization.

## Authorization boundary

Workspace roles (`owner`, `admin`, `member`, `viewer`) only authorize actions inside a workspace. They never grant access to `/admin`.

Platform access is represented by `platform_admin_grants`, keyed directly to the Better Auth user ID. A revoked grant denies access even if the user's email remains in the bootstrap environment variable.

For the first deployment, `PLATFORM_ADMIN_USER_IDS` can bootstrap exact Better Auth identities. `PLATFORM_ADMIN_EMAILS` is also supported, but only when the authenticated Better Auth user has `emailVerified=true`. This matters because the current email/password configuration does not require verification. On the first valid bootstrap request, the app persists a platform-admin grant. These environment variables are bootstrap mechanisms only; they are not workspace-role mappings.

The `/admin/access` surface is the normal post-bootstrap grant/revoke workflow. It requires an existing platform-admin session, records the acting administrator, prevents self-revocation from the UI/action, and audits both grant and revoke operations.

## Admin routes

The control plane exposes:

- `/admin`
- `/admin/organizations`
- `/admin/organizations/[id]`
- `/admin/users`
- `/admin/access`
- `/admin/billing`
- `/admin/campaigns`
- `/admin/connections`
- `/admin/imports`
- `/admin/webhooks`
- `/admin/system`
- `/admin/audit`
- `/admin/audit/export`

High-volume organization, user, billing, connection, webhook, and audit views use bounded pages and query filters rather than unbounded table scans into the rendered UI.

## Operational controls

Organization suspension/reactivation, user disable/re-enable, workspace membership role changes/removal, platform-admin grant/revoke, manual-subscription plan/suspension controls, safe queue retries, and plan/limit changes are server actions guarded by `requirePlatformAdmin`.

Platform mutations write `platform_audit_events`. Billing mutations additionally flow through the billing admin domain service, which writes billing/workspace audit records. Provider-managed subscriptions are intentionally read-only in the platform UI so local changes cannot drift from the external billing provider.

Queue retry is intentionally allowlisted. Campaign-dispatch and contact-import failed jobs may be retried after verifying the BullMQ job is still in `failed` state. Message-send jobs are not retried generically because the worker also persists recipient delivery state; a raw BullMQ retry can otherwise consume the job without restoring the recipient to a claimable state. Webhook jobs are also not retried generically: operators use `/admin/webhooks`, which resets the durable webhook event state under a compare-and-update guard before requeueing it.

Owner membership changes are serialized per organization before checking the owner count and applying a demotion or removal. This prevents concurrent platform-admin actions from independently passing a stale last-owner check and leaving a workspace without an owner.

Suspended organizations are blocked from normal workspace-authenticated application paths. Disabled users are also blocked from those paths. The `/admin` authorization check uses the authenticated identity directly instead of workspace context so platform administration does not depend on workspace membership or workspace status.

## Billing and Meta troubleshooting

`/admin/billing` shows subscription, invoice, and payment state across organizations. Manual subscriptions expose guarded plan/suspension operations; provider-managed subscriptions remain inspect-only and direct operators to the provider for changes.

`/admin/connections` exposes WhatsApp connection status, connection-health status, reauthorization requirement, last validation time, credential expiry, quality/throughput, and the latest failure code/reason. The organization detail page repeats the most relevant connection and billing state for support workflows.

## Audit model

`platform_audit_events` stores the platform actor, optional organization, action, target type/id, structured metadata, and timestamp. Audit events are append-only from the application surface; there is no admin UI action for editing or deleting them.

The audit view supports filtering and pagination. CSV export is capped at 5,000 rows per export, applies the current search/action filters, protects spreadsheet cells from formula execution prefixes, and records an `audit.exported` event with the actor and export scope.

## Impersonation

User impersonation is intentionally not implemented. Adding it later would require a separate threat model, explicit short-lived elevation, conspicuous session state, and dedicated audit coverage.