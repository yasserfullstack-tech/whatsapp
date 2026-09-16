# Disaster recovery

The recovery priority is to protect authoritative data first, then restore queue processing and public traffic. PostgreSQL is the primary system of record; R2 contains externally stored transient/derived objects; Valkey contains queue/rate-limit/session state that must remain consistent with the database.

## Recovery principles

- Do not destroy the only damaged copy while investigating an incident.
- Restore into clean infrastructure where possible and switch over only after validation.
- Treat a PostgreSQL backup as usable only after checksum verification, isolated restore verification, and confirmed off-server presence.
- Keep production secrets, the database backup decryption identity, DNS access, R2 access, and Meta credentials recoverable independently from the application VPS.
- Do not replay old Valkey queue state into a database restored to a different point in time without explicit reconciliation.
- Reopen traffic gradually: database, Valkey, API readiness, one worker, queue verification, normal workers, then Caddy/public traffic.
- Preserve incident and drill evidence without placing credentials, recovery keys, decrypted dumps, or customer PII in GitHub.

## Initial launch recovery objectives

The repository defines these engineering objectives for PR-010:

- **PostgreSQL RPO target:** no more than 24 hours of committed database changes, backed by the nightly verified/off-server backup cadence.
- **Service recovery RTO target:** no more than 4 hours from recovery declaration to restored database, compatible migrations, API/worker readiness, and successful public smoke test.

These are launch targets, not a claim that production has already demonstrated them. They become accepted only when the owner records acceptance in issue #55 and the clean-host drill evidence shows that the RTO is achievable. If the business requires an RPO below 24 hours, add and rehearse PostgreSQL WAL archiving/PITR rather than claiming that nightly logical dumps meet the tighter objective.

The backup freshness alert remains a guardrail around the schedule; see `docs/backups.md` for activation, evidence collection, and the clean-host drill procedure.

## Failure scenarios

### VPS loss

Provision a replacement host, install Docker/Compose, restore the reviewed release and host secrets from the independent secret-recovery process, restore PostgreSQL from the latest verified off-server backup, start a fresh Valkey unless a consistent durable copy is known-good, verify/provision the external R2 bucket, then follow the normal deployment flow. DNS can move only after `/ready`, worker/queue checks, and the public smoke test pass.

### PostgreSQL corruption or accidental deletion

Freeze writes, preserve the affected volume, identify the last known-good verified backup, restore to a new Postgres volume/instance, apply only compatible migrations, compare critical counts and recent business events, then switch application `DATABASE_URL`. If data after the backup must be recovered, analyze WAL/other evidence before discarding the damaged database.

### Valkey loss

Valkey is configured with AOF `everysec` and `noeviction`, but a total Valkey loss can still discard pending queue/session/rate-limit state. Start clean Valkey only after understanding what durable database jobs remain incomplete. Reconciliation must be driven from database state rather than assuming every lost queued job can be safely recreated. Watch duplicates and idempotency protections as processing resumes.

### R2 object loss

The current durable recovery strategy is intentionally based on the repository's present object classes:

- data exports are derived from PostgreSQL and can be regenerated,
- import source files are transient and can be re-uploaded if lost, and
- workspace deletion intentionally purges the tenant storage prefix.

Cloudflare R2 durability does not protect against intentional or accidental deletion, so the primary application bucket must not be treated as an independent backup. Do not apply blanket object locks that would conflict with workspace deletion or configured retention. After a bucket-loss event, provision a replacement production bucket, verify tenant-prefix authorization and signed object flows, regenerate exports as needed, require re-upload of affected imports, and run application/storage smoke tests before normal traffic resumes.

Any future non-reproducible durable object class requires an independent, retention-compatible recovery/version-preservation design plus a restore drill before launch. The detailed R2 strategy and official provider references are in `docs/backups.md`.

### Credential or encryption-key loss

Rotate compromised credentials immediately. Losing `CREDENTIAL_ENCRYPTION_KEY` can make stored Meta credentials impossible to decrypt, so keep a separately protected recovery copy. After a key rotation, credentials must be re-encrypted through an explicit migration/rotation process; simply replacing the environment value is not sufficient.

The PostgreSQL backup `age` private identity is a separate recovery secret. The production host may need access to it for automated restore verification, but an independent secured copy must exist away from that host so host loss does not also destroy restore capability.

## Full recovery order

1. Declare the incident and stop automated deployments, backup retention jobs, and application writes that could complicate recovery.
2. Preserve logs, Sentry events, damaged volumes, release identifiers, and other incident evidence.
3. Provision isolated recovery infrastructure.
4. Fetch the selected encrypted PostgreSQL backup and checksum from off-server storage.
5. Verify the SHA-256 checksum and restore the backup into clean PostgreSQL.
6. Apply only migrations required by the target release and verify schema/data.
7. Configure a clean or known-consistent Valkey and verify/recreate R2 access.
8. Start API and check `/health`, `/ready`, and internal `/metrics`.
9. Start a single worker and inspect queue depth, failures, retries, reconciliation, and webhook lag.
10. Scale workers to the validated replica/concurrency level.
11. Start web/Caddy, run `infra/production/scripts/smoke-test.sh`, then reopen DNS/traffic.
12. Continue monitoring Grafana, structured logs, Sentry, Meta errors/429s, database connections, and queue recovery until the incident is closed.
13. Record actual data age, recovery duration, gaps, and follow-up actions against issue #55 or the incident record.

## Recovery drill procedure

Automated backup jobs already restore every encrypted dump into an isolated disposable PostgreSQL instance before recording success. PR-010 additionally requires a clean-host exercise because integrity testing on the production VPS does not prove that operators can recover after losing that VPS.

At least quarterly:

1. provision a fresh recovery host with no reused application/database volumes,
2. install Docker, `age`, and `rclone`,
3. retrieve the exact release under test plus the independently stored recovery credentials,
4. run `sh infra/production/scripts/recovery-drill.sh` against the off-server backup destination,
5. restore/start the recovery application stack with a clean/known-consistent Valkey,
6. run the deployment smoke test and verify worker/queue behavior,
7. record the latest backup age at drill start and total time from declaration to smoke-test success,
8. compare the result with the 24-hour RPO / 4-hour RTO objectives, and
9. attach only redacted evidence to issue #55.

Before marking PR-010 complete, issue #55 must contain evidence that scheduled backups are actually running, off-server copies are present, freshness monitoring is active, a clean-host recovery succeeded, the R2 strategy is accepted, and the owner has accepted the measured RPO/RTO.
