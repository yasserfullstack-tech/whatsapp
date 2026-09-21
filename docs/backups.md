# PostgreSQL backups and restore verification

PR-010 treats a database backup as complete only when all of the following are true:

1. `pg_dump` completes without error,
2. the dump is encrypted before it is written to persistent host storage,
3. the encrypted dump restores successfully into an isolated PostgreSQL instance,
4. the encrypted artifact and portable SHA-256 checksum are copied off the application VPS, and
5. both expected off-server objects are visible before the success metric is written.

`infra/production/scripts/backup-postgres.sh` enforces that sequence. It streams `pg_dump` directly into `age`, so an unencrypted database dump is not written to disk.

## Backup host configuration

Install Docker/Compose, `age`, and `rclone` on the production VPS. Create the backup encryption identity on a secured operator system. The public `age` recipient may be placed in the backup environment; the private identity is a recovery secret and must have an independently secured copy away from the application VPS.

Start from the committed template:

```bash
sudo install -d -m 700 /etc/whatsapp /root/.config/whatsapp-backup /var/backups/whatsapp
sudo install -m 600 infra/production/backup.env.example /etc/whatsapp/backup.env
sudoedit /etc/whatsapp/backup.env
sudo chmod 600 /etc/whatsapp/backup.env
sudo chmod 600 /root/.config/whatsapp-backup/age-identity.txt
```

The populated file must not be committed. The default production paths in the template are:

```bash
APP_DIR=/srv/whatsapp
BACKUP_AGE_RECIPIENT=age1replace-with-public-recipient
BACKUP_AGE_IDENTITY_FILE=/root/.config/whatsapp-backup/age-identity.txt
BACKUP_RCLONE_REMOTE=encrypted-backups:whatsapp/postgres
BACKUP_DIR=/var/backups/whatsapp/postgres
BACKUP_METRICS_DIR=/var/lib/whatsapp/node-exporter
LOCAL_RETENTION_DAYS=14
OFFSITE_RETENTION_DAYS=35
ENV_FILE=/srv/whatsapp/.env.production
COMPOSE_FILE=/srv/whatsapp/docker-compose.production.yml
VERIFY_SCRIPT=/srv/whatsapp/infra/production/scripts/verify-postgres-backup.sh
```

The off-server destination must use credentials independent from the application runtime credentials. Prefer a dedicated path/bucket and a least-privilege token that can write, list, read for recovery, and apply the intended backup retention without granting unrelated production storage access.

## Activate the nightly systemd schedule

The repository provides a persistent systemd timer at `02:17 UTC` and a one-shot service. `Persistent=true` means a missed run caused by host downtime is triggered after the timer becomes active again.

Install and enable it from the deployed checkout:

```bash
cd /srv/whatsapp
sudo sh infra/production/scripts/install-backup-schedule.sh
```

The installer requires `/etc/whatsapp/backup.env` to be mode `600` or `400` and enables `whatsapp-backup.timer`. It deliberately does not start a heavy dump immediately unless requested.

For initial activation/proof, run one backup explicitly after validating the configuration:

```bash
cd /srv/whatsapp
sudo RUN_INITIAL_BACKUP=1 sh infra/production/scripts/install-backup-schedule.sh
sudo systemctl status whatsapp-backup.service --no-pager
sudo systemctl list-timers whatsapp-backup.timer --no-pager
```

A non-zero backup service exit is a failed backup and must be investigated before launch.

## What the backup job does

The job:

- runs `pg_dump` in custom format against the production PostgreSQL container,
- encrypts the stream with the configured `age` recipient,
- writes a SHA-256 file containing the encrypted artifact's basename rather than a VPS-specific absolute path,
- invokes `verify-postgres-backup.sh`, which restores into a disposable PostgreSQL 17 container and verifies restored public tables plus a query,
- copies both encrypted dump and checksum to the off-server destination,
- confirms both off-server object names are visible,
- applies local and off-server retention only after verification/upload succeeds, and
- writes a node-exporter success timestamp only after the complete sequence succeeds.

A failed restore, failed off-server copy, or missing remote artifact makes the entire backup job fail. The script also writes a failure timestamp on any non-zero exit.

## Freshness monitoring

`BACKUP_METRICS_DIR` must match `NODE_EXPORTER_TEXTFILE_DIR` from the production environment. PR-011 already exposes and alerts on:

- missing backup success metrics,
- a successful backup older than 26 hours, and
- a recent backup failure.

The nightly schedule is intended to meet a PostgreSQL backup RPO objective of no more than 24 hours under healthy operation. The 26-hour alert is a failure/staleness guard, not permission to treat 26 hours as the desired RPO.

To produce a redacted launch-evidence snapshot on the production host:

```bash
sudo sh infra/production/scripts/collect-backup-recovery-evidence.sh \
  /tmp/backup-recovery-evidence.md
```

The collector fails unless the timer is enabled/active, the last success metric is within the configured evidence-age ceiling, and a matching encrypted dump/checksum pair is visible off-server. It intentionally omits the remote name, credentials, age identity, database credentials, customer data, and decrypted content.

## Clean-host recovery drill

Nightly isolated restore verification is necessary but does not replace a clean host recovery exercise. At least quarterly, and before PR-010 is marked complete for launch, perform a drill on a newly provisioned recovery host with no reused application/database volumes.

On the clean host:

1. install Docker, `age`, and `rclone`,
2. check out the exact release being tested,
3. supply the off-server rclone configuration and the recovery `age` identity through the recovery secret process, not from the failed application VPS,
4. set `BACKUP_RCLONE_REMOTE` and `BACKUP_AGE_IDENTITY_FILE`,
5. run the off-server download/checksum/restore drill,
6. follow `docs/disaster-recovery.md` to restore a recovery application environment, start a fresh/known-consistent Valkey, run migrations compatible with the tested release, and execute the deployment smoke test, and
7. record the measured data age and recovery duration.

The database-artifact drill command is:

```bash
sudo -E sh infra/production/scripts/recovery-drill.sh
```

`recovery-drill.sh` selects the newest off-server `postgres-*.dump.age`, downloads it and its checksum, validates SHA-256 independently of the original host path, restores it into an isolated clean PostgreSQL container, and emits a redacted Markdown evidence file. Attach that record together with clean host provisioning evidence and the application smoke-test result to issue #55.

For a manual artifact check, downloaded checksum files are portable and may also be verified from their download directory:

```bash
sha256sum -c postgres-YYYYMMDDTHHMMSSZ.dump.age.sha256
BACKUP_AGE_IDENTITY_FILE=/secure/path/age-identity.txt \
  ./infra/production/scripts/verify-postgres-backup.sh postgres-YYYYMMDDTHHMMSSZ.dump.age
```

## PostgreSQL recovery objectives

The repository defines the initial launch engineering objectives below; they are not considered business-accepted until the owner records acceptance in issue #55 and a measured drill demonstrates the RTO.

- **PostgreSQL RPO target:** at most 24 hours of committed database changes, based on the nightly verified/off-server backup cadence.
- **Service recovery RTO target:** at most 4 hours from recovery declaration to database restore, compatible migrations, API/worker readiness, and public smoke-test success.

If a 24-hour RPO is not acceptable for the business, nightly logical dumps are insufficient. Add PostgreSQL WAL archiving/PITR to an independent encrypted destination and rehearse that path before tightening the RPO claim.

## R2/object-storage recovery strategy

PostgreSQL is the authoritative source for current application state. The current R2 object classes are intentionally bounded:

- data exports are derived from PostgreSQL and can be regenerated; they expire according to `export_file_hours`,
- import source files are transient and can be re-uploaded if lost; their retention is separately bounded, and
- workspace deletion intentionally removes the entire tenant R2 prefix before relational deletion completes.

Cloudflare documents R2 as highly durable, but durability does not protect against intentional or accidental deletion. Cloudflare also provides bucket locks and lifecycle rules. Do not assume the primary application bucket is a backup, and do not apply a blanket retention lock that would conflict with workspace deletion or configured object-retention duties.

For the current object classes, recovery after primary-bucket loss is therefore:

1. provision a replacement production bucket with separate production credentials,
2. verify tenant-prefix authorization and signed upload/download behavior,
3. regenerate export artifacts from PostgreSQL as requested,
4. require affected in-flight imports to be re-uploaded, and
5. run storage and application smoke tests before normal traffic resumes.

If a future feature introduces non-reproducible customer objects (for example, durable media that cannot be rebuilt from PostgreSQL), PR-010's current strategy is no longer sufficient. That object class must gain a retention-compatible independent copy/version-preservation design and a restore drill before it can be treated as production-ready.

Official R2 operational references:

- Durability: https://developers.cloudflare.com/r2/reference/durability/
- Bucket locks: https://developers.cloudflare.com/r2/buckets/bucket-locks/
- Object lifecycles: https://developers.cloudflare.com/r2/buckets/object-lifecycles/

## Disaster restore sequence

For an actual database loss/corruption event:

1. stop Caddy, web, API, workers, and automated maintenance that can create writes,
2. preserve the damaged database/volume and incident evidence where possible,
3. provision clean recovery infrastructure,
4. fetch the selected encrypted backup and checksum from off-server storage,
5. verify checksum and decrypt with the protected recovery identity,
6. restore with `pg_restore --exit-on-error --no-owner --no-privileges`,
7. run only the migrations required by the release being restored,
8. verify critical table counts/constraints and application `/ready`,
9. attach a fresh or known-consistent Valkey; do not blindly replay stale queue state against a different database point in time,
10. start one worker replica first and inspect queue/reconciliation behavior,
11. scale workers after validation, then run the public deployment smoke test before reopening traffic, and
12. preserve the drill/incident evidence without attaching credentials, recovery keys, decrypted dumps, or customer PII to GitHub.
