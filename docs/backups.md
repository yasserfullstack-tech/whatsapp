# PostgreSQL backups and restore verification

A database backup is considered complete only when all three conditions are true:

1. the dump is created without error,
2. the encrypted dump restores successfully into an isolated PostgreSQL instance and passes verification,
3. the verified encrypted artifact and checksum are copied off the application VPS.

`infra/production/scripts/backup-postgres.sh` enforces that sequence. It streams `pg_dump` directly into `age`, so an unencrypted database dump is not written to disk.

## Backup host configuration

Install `age` and `rclone` on the VPS. Create a dedicated backup encryption identity on a secured operator system, keep the private identity out of Git and preferably off the application VPS except where restore automation explicitly needs it, and configure an off-server rclone destination. The destination should have its own retention/versioning controls and credentials with only the permissions needed for the backup path.

The scheduled backup process needs these environment variables in a root-owned file such as `/etc/whatsapp/backup.env`:

```bash
BACKUP_AGE_RECIPIENT=age1examplepublicrecipient...
BACKUP_AGE_IDENTITY_FILE=/root/.config/whatsapp-backup/age-identity.txt
BACKUP_RCLONE_REMOTE=encrypted-backups:whatsapp/postgres
BACKUP_DIR=/var/backups/whatsapp/postgres
LOCAL_RETENTION_DAYS=14
OFFSITE_RETENTION_DAYS=35
ENV_FILE=/srv/whatsapp/.env.production
COMPOSE_FILE=/srv/whatsapp/docker-compose.production.yml
VERIFY_SCRIPT=/srv/whatsapp/infra/production/scripts/verify-postgres-backup.sh
```

Protect both files:

```bash
chmod 600 /etc/whatsapp/backup.env /root/.config/whatsapp-backup/age-identity.txt
chmod 700 /var/backups/whatsapp
```

The identity used to decrypt backups is more sensitive than the public `age` recipient. Keep an independently secured copy so losing the VPS does not also lose the ability to restore.

## Nightly schedule

A simple root cron entry can run the backup nightly. The exact time should avoid the busiest campaign window:

```cron
17 2 * * * set -a; . /etc/whatsapp/backup.env; set +a; cd /srv/whatsapp && ./infra/production/scripts/backup-postgres.sh >> /var/log/whatsapp-backup.log 2>&1
```

A systemd timer is also appropriate. In either case, alert on non-zero exit and on absence of a recent verified off-server artifact. Retention defaults in the script are 14 days locally and 35 days off-server; adjust them to legal/business requirements rather than treating these values as policy.

## What the script does

The backup script:

- runs `pg_dump` in custom format against the production Postgres container,
- encrypts the stream with the configured `age` recipient,
- calculates SHA-256 for the encrypted file,
- invokes `verify-postgres-backup.sh`, which restores into a disposable PostgreSQL 17 container and verifies restored public tables plus a query,
- copies both encrypted dump and checksum to the off-server destination,
- applies local and off-server retention only after verification/upload succeeds.

A failed restore makes the entire backup job fail.

## Manual restore drill

Test the actual recovery path regularly, not only `pg_restore` syntax. Download a recent backup and checksum from off-server storage, verify its checksum, then run:

```bash
sha256sum -c postgres-YYYYMMDDTHHMMSSZ.dump.age.sha256
BACKUP_AGE_IDENTITY_FILE=/secure/path/age-identity.txt \
  ./infra/production/scripts/verify-postgres-backup.sh postgres-YYYYMMDDTHHMMSSZ.dump.age
```

The nightly script performs an isolated restore verification automatically. In addition, run a full operator recovery drill at least quarterly: provision a clean environment, restore the database, apply any newer compatible migrations, start the application against the restored database and isolated Valkey, and perform functional smoke tests.

## Disaster restore procedure

For an actual database loss/corruption event:

1. stop Caddy, web, API, and workers to stop writes; preserve the damaged database for investigation if possible,
2. provision a clean PostgreSQL instance/volume rather than overwriting the only copy of damaged data,
3. fetch the selected encrypted backup and checksum from off-server storage,
4. verify checksum and decrypt with the protected `age` identity,
5. restore with `pg_restore --exit-on-error --no-owner --no-privileges`,
6. run the repository migrations needed by the release being restored,
7. verify critical table counts/constraints and application `/ready`,
8. attach a clean Valkey instance; do not blindly restore stale queue state against a different database point-in-time,
9. start one worker replica first, inspect queue behavior, then restore normal replicas,
10. run the deployment smoke test and monitor errors, queue depth, and Sentry before reopening traffic.

If point-in-time recovery becomes a business requirement, add PostgreSQL WAL archiving to an independent encrypted destination. Nightly logical dumps alone cannot provide point-in-time recovery.

## R2 and other state

This script protects PostgreSQL only. R2 is external and must have its own versioning/lifecycle/retention and recovery plan. Valkey AOF improves queue durability across process/host restarts, but it is not a substitute for database backups and should not be restored independently to an arbitrary older/newer database snapshot without reconciliation.
