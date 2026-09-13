# Disaster recovery

The recovery priority is to protect authoritative data first, then restore queue processing and public traffic. PostgreSQL is the primary system of record; R2 contains externally stored objects; Valkey contains queue/rate-limit/session state that must remain consistent with the database.

## Recovery principles

- Do not destroy the only damaged copy while investigating an incident.
- Restore into clean infrastructure where possible and switch over after validation.
- Treat a backup as usable only after checksum and restore verification.
- Keep production secrets, the database backup decryption identity, DNS access, R2 access, and Meta credentials recoverable independently from the application VPS.
- Do not replay old Valkey queue state into a database restored to a different point in time without explicit reconciliation.
- Reopen traffic gradually: database, Valkey, API readiness, one worker, queue verification, normal workers, then Caddy/public traffic.

## Failure scenarios

### VPS loss

Provision a replacement host, install Docker/Compose, restore the reviewed release and host secrets, restore PostgreSQL from the latest verified off-server backup, start a fresh Valkey unless a consistent durable copy is known-good, verify the external R2 bucket, then follow the normal deployment flow. DNS can move only after `/ready` and worker/queue checks pass.

### PostgreSQL corruption or accidental deletion

Freeze writes, preserve the affected volume, identify the last known-good verified backup, restore to a new Postgres volume/instance, apply compatible migrations, compare critical counts and recent business events, then switch application `DATABASE_URL`. If data after the backup must be recovered, analyze WAL/other evidence before discarding the damaged database.

### Valkey loss

Valkey is configured with AOF `everysec` and `noeviction`, but a total Valkey loss can still discard pending queue/session/rate-limit state. Start clean Valkey only after understanding what database jobs are incomplete. Reconciliation must be driven from durable database state rather than assuming every lost queued job can be safely recreated. Watch duplicates and idempotency protections as processing resumes.

### R2 object loss

Do not recreate database rows that reference missing objects until recovery is understood. Use Cloudflare/object-storage retention/versioning/replication appropriate to the data class. Imports may be re-uploadable; exports are generally reproducible; those assumptions must be verified per object type rather than applied globally.

### Credential or encryption-key loss

Rotate compromised credentials immediately. Losing `CREDENTIAL_ENCRYPTION_KEY` can make stored Meta credentials impossible to decrypt, so keep a separately protected recovery copy. After a key rotation, credentials must be re-encrypted through an explicit migration/rotation process; simply replacing the env value is not sufficient.

## Full recovery order

1. Declare the incident and stop automated deployments/maintenance jobs.
2. Preserve logs, Sentry events, damaged volumes, and the release identifier.
3. Provision isolated recovery infrastructure.
4. Restore PostgreSQL from a checksum-validated, restore-verified backup.
5. Apply only the migrations required by the target release and verify schema/data.
6. Configure a clean or known-consistent Valkey and verify R2 access.
7. Start API and check `/health`, `/ready`, and internal `/metrics`.
8. Start a single worker and inspect queue depth, failures, retries, and webhook lag.
9. Scale workers to the validated replica/concurrency level.
10. Start web/Caddy, run `infra/production/scripts/smoke-test.sh`, then reopen DNS/traffic.
11. Monitor Grafana, structured logs, Sentry, Meta errors/429s, database connections, and queue recovery until the incident is closed.

## Recovery objectives and drills

This repository does not declare an RPO/RTO that has not been tested. With nightly backups, data loss can approach the interval between successful backups; actual recovery time depends on backup size, download bandwidth, migration time, and validation.

Automated nightly restore verification checks backup integrity. Run a full clean-host recovery exercise at least quarterly and record measured restore duration, data age, operator steps, and gaps. Use those measured results to define business-approved RPO/RTO targets.
