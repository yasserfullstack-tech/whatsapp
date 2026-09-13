# Platform administration

The platform control plane is intentionally separate from workspace authorization.

## Authorization boundary

Workspace roles (`owner`, `admin`, `member`, `viewer`) only authorize actions inside a workspace. They never grant access to `/admin`.

Platform access is represented by `platform_admin_grants`, keyed directly to the Better Auth user ID. A revoked grant denies access even if the user's email remains in the bootstrap environment variable.

For the first deployment, `PLATFORM_ADMIN_USER_IDS` can bootstrap exact Better Auth identities. `PLATFORM_ADMIN_EMAILS` is also supported, but only when the authenticated Better Auth user has `emailVerified=true`. This matters because the current email/password configuration does not require verification. On the first valid bootstrap request, the app persists a platform-admin grant. These environment variables are bootstrap mechanisms only; they are not workspace-role mappings.

## Admin routes

The initial control plane exposes:

- `/admin`
- `/admin/organizations`
- `/admin/organizations/[id]`
- `/admin/users`
- `/admin/campaigns`
- `/admin/connections`
- `/admin/imports`
- `/admin/webhooks`
- `/admin/system`
- `/admin/audit`

## Operational controls

Organization suspension and reactivation, user disable/re-enable, and plan/limit changes are implemented as server actions. Mutations write a `platform_audit_events` record in the same database transaction as the control change.

Suspended organizations are blocked from normal workspace-authenticated application paths. Disabled users are also blocked from those paths. The `/admin` authorization check uses the authenticated identity directly instead of workspace context so platform administration does not depend on workspace membership or workspace status.

## Audit model

`platform_audit_events` stores the platform actor, optional organization, action, target type/id, structured metadata, and timestamp. Audit events are append-only from the application surface; there is no admin UI action for editing or deleting them.

## Impersonation

User impersonation is intentionally not implemented. Adding it later would require a separate threat model, explicit short-lived elevation, conspicuous session state, and dedicated audit coverage.
