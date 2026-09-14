# Data lifecycle

The data lifecycle subsystem owns workspace exports, retention cleanup, workspace deletion, and account deletion boundaries.

## Exports

`POST /api/settings/data/export` creates a durable `data_export_jobs` record and attempts to enqueue a BullMQ job. The worker also reconciles queued database rows every minute, so a temporary Redis outage cannot lose the request. Large exports are paged in batches, written as NDJSON without accumulating the dataset in memory, uploaded to tenant-prefixed R2 storage, and marked `completed` only after upload succeeds.

Object keys use `<organization id>/data-exports/<job id>/<random nonce>.ndjson`. The key is not exposed to browsers. `GET /api/settings/data/export/:id/download` re-checks workspace authorization and organization ownership before issuing a five-minute signed GET URL. Export objects expire according to `export_file_hours` (default 24 hours, maximum 168 hours).

Workspace exports deliberately omit credential secrets, credential keys, auth sessions, password hashes, raw webhook payloads, and permanent storage credentials.

## Retention

`data_retention_policies` supports per-workspace limits for raw processed webhook rows, import files, export files, workspace audit events, and historical campaign recipients. Defaults are 30 days, 7 days, 24 hours, 365 days, and 365 days respectively. Cleanup is idempotent. Import rows record `object_deleted_at` after R2 deletion.

Platform audit records are outside workspace retention and workspace purge rules. No billing/invoice tables currently exist in this repository; when provider-neutral billing records are introduced, they must have their own statutory retention rules rather than being attached to workspace purge by default.

## Workspace deletion

Only the workspace owner can request deletion. The API requires a session created within the last ten minutes, explicit acknowledgement, and exact typing of the workspace slug. A request has a seven-day cooling-off period. It can be cancelled during that period. After cooling off, the workspace is suspended for 24 hours and then a purge job runs.

Purge first deletes and verifies the entire `<organization id>/` R2 prefix. Only then does it delete the organization row; tenant-owned relational records cascade from that boundary. `workspace_deletion_requests` and `data_lifecycle_audit_logs` intentionally survive organization deletion so there is durable evidence of who requested the operation, lifecycle timestamps, failures, and the number of storage objects removed.

## Account deletion

Account deletion also requires a recent session plus the literal `DELETE ACCOUNT`. A user who owns any workspace must transfer ownership or complete workspace deletion first. The account operation removes the application user plus the Better Auth user; database cascades remove memberships, sessions, linked auth accounts, two-factor state, and user controls. Lifecycle audit evidence is written before deletion.

## Security invariants

Every export query derives organization scope from authenticated workspace context. Object keys are opaque and tenant-prefixed. Download URLs are short-lived and never expose R2 credentials. Workspace deletion is owner-only. Retention changes are owner/admin operations. Export, retention, download-link, deletion, cancellation, and account-deletion events are audited. Cross-tenant identifiers never select an export job because download lookup includes both job ID and authenticated organization ID.
