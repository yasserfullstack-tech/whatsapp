# Database migrations

PostgreSQL schema changes are versioned with Drizzle Kit. The committed `packages/db/drizzle/` directory is part of the application release and is the only schema-change path for shared, staging, and production databases.

## Normal schema-change workflow

1. Edit the Drizzle schema modules in `packages/db/src/`.
2. Generate a named migration:

   ```bash
   bun run db:generate -- --name=<short_change_name>
   ```

3. Review the generated SQL plus Drizzle's journal/snapshot metadata under `packages/db/drizzle/`.
4. Commit the schema change and generated migration artifacts together.
5. Apply the migration locally:

   ```bash
   bun run db:migrate
   bun run db:verify
   ```

Do not edit a migration after it has been applied to a shared environment. Correct an applied migration with a new forward migration.

## Local development

For a fresh local checkout:

```bash
cp .env.example .env
bun install
bun run infra:up
bun run db:migrate
bun run db:verify
bun run dev
```

`bun run db:push:dev` remains available only for disposable local experiments. It must not be used for staging, production, or any database whose data matters, because push does not provide the release history and review boundary that committed migrations do.

### Existing local databases created with db:push

The initial `0000_baseline` migration creates the complete current schema. A database that already has those tables from earlier `db:push` development cannot safely run that baseline as if it were empty.

If the local database is disposable, reset it before switching to migrations:

```bash
docker compose down -v
bun run infra:up
bun run db:migrate
bun run db:verify
```

`docker compose down -v` deletes the local PostgreSQL and Valkey volumes. Do not use it when the data needs to be preserved.

For any non-disposable database that predates the migration baseline, take a backup and perform an explicit baseline/adoption review instead of running `0000_baseline` blindly. The project is expected to enter production from a fresh migration-managed database.

## CI contract

CI enforces two migration properties on every pull request:

- **No migration drift:** `drizzle-kit generate` must produce no uncommitted changes when run against the committed schema and snapshots. A schema change without its generated migration fails CI.
- **Fresh database bootstrap:** CI starts a clean PostgreSQL 17 service, runs every committed migration, and then verifies all expected application tables plus Drizzle's migration log.

The normal tests, TypeScript checks, and production Next.js build run only after migration validation succeeds.

## Production deployment

For each release that contains a migration:

1. Take or verify a restorable database backup/snapshot.
2. Deploy or stage the release artifact that contains the matching migration files.
3. Run `bun run db:migrate` once against the target database.
4. Run `bun run db:verify`.
5. Start/roll the application and workers that depend on the new schema.
6. Watch database errors, worker failures, and application health during the rollout.

Prefer expand/contract migrations for changes that cannot be deployed atomically with the application: add nullable/new structures first, deploy code that understands both shapes, backfill if required, and remove old structures in a later release.

## Rollback policy

Drizzle's migration flow here is forward-only; there is no automatic `down` command in the release process.

- Rolling application code back is safe only when the migrated schema remains backward-compatible with that older application version.
- If the schema change itself must be reversed, prefer a reviewed forward-fix migration.
- For destructive or unrecoverable migration failures, restore the verified database backup/snapshot and redeploy the matching application release.
- Never delete or rewrite an already-applied migration entry to make history appear clean.

## Migration files

The baseline consists of:

```text
packages/db/drizzle/
  0000_baseline.sql
  meta/
    _journal.json
    0000_snapshot.json
```

The SQL is what `drizzle-kit migrate` applies. The journal records migration order, and the snapshots allow future `drizzle-kit generate` runs to compute the next schema diff deterministically.
