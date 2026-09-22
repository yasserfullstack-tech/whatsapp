# WhatsApp Marketing Platform

Multi-tenant SaaS for businesses to connect their own WhatsApp Business account, import opted-in contacts, build reusable audiences, manage approved templates, send large campaigns through Meta's WhatsApp Cloud API, and track delivery/read analytics.

## Stack

- Next.js 16.3.3 + React 19.3
- Bun 1.4.2
- TypeScript 7
- Hono API
- PostgreSQL + Drizzle ORM
- Better Auth (self-hosted sessions)
- BullMQ + Valkey/Redis
- Cloudflare R2 for large CSV uploads
- Meta WhatsApp Cloud API / Embedded Signup

## Repository

```text
apps/
  web/       Next.js workspace app, platform-admin control plane, auth, contacts/consent, audiences, campaigns, billing, Meta Embedded Signup BFF routes
  api/       Hono API + signed Meta webhook ingress
  worker/    contact import, campaign dispatch, send, and webhook workers
packages/
  auth/          Better Auth server configuration
  config/        validated runtime configuration
  credentials/   AES-256-GCM credential encryption helpers
  db/            Drizzle schema, versioned migrations, audience predicates, and database client
  meta/          Meta Cloud API + Embedded Signup/webhook helpers
  billing/       provider-neutral billing model, entitlements, and admin services
  notifications/ in-app/email notification runtime and SMTP transport
  observability/ structured logging and metrics
  queue/         BullMQ queues + per-phone limiter
  storage/       Cloudflare R2 / S3-compatible storage helpers
docs/
  architecture.md
  audiences.md
  database-migrations.md
  load-testing.md
  opt-outs.md
  r2.md
  webhooks.md
```

## Local development

Requirements: Bun 1.4.2+, Docker, and Docker Compose.

```bash
cp .env.example .env
bun install
bun run infra:up
bun run db:migrate
bun run db:verify
bun run dev
```

The web app runs on `http://localhost:3000` and the API defaults to `http://localhost:4000`.

Committed Drizzle migrations are now the default schema workflow. Use `bun run db:generate -- --name=<change>` when changing schema and commit the generated SQL/journal/snapshot artifacts together. `bun run db:push:dev` exists only for disposable local experiments and must not be used for staging or production. See `docs/database-migrations.md` for deployment, adoption, and rollback guidance.

## Required local secrets

At minimum, set these values in `.env`:

- `BETTER_AUTH_SECRET` — long random session secret.
- `CREDENTIAL_ENCRYPTION_KEY` — exactly 32 random bytes, base64 encoded (`openssl rand -base64 32`).
- `META_APP_ID` and `META_APP_SECRET` — the Meta app used by the platform.
- `META_CONFIG_ID` — the WhatsApp Embedded Signup configuration ID.
- `META_VERIFY_TOKEN` — private webhook verification value.
- Cloudflare R2 account, access key, secret, and bucket values for contact imports.

For the first platform administrator, optionally bootstrap access with `PLATFORM_ADMIN_USER_IDS` or `PLATFORM_ADMIN_EMAILS`. Email bootstrap only applies to a verified authentication email; a successful bootstrap is persisted as a database admin grant.

Never commit real Meta tokens or production secrets.

## Implemented flow

1. User creates an account or signs in and receives an internal workspace.
2. Meta Embedded Signup connects the client's own WABA and phone number.
3. The server exchanges the signup code, verifies the phone, subscribes the app, encrypts the tenant access token, and stores the connection.
4. CSV files upload directly from the browser to R2 and stream through background contact-import workers.
5. Imports normalize E.164 phone numbers, preserve consent metadata, deduplicate contacts, and can add valid contacts to reusable lists.
6. Users can review contact eligibility and active suppressions; manual suppressions immediately block future marketing sends.
7. Inbound WhatsApp opt-outs and dashboard suppression actions append immutable consent-history events.
8. Only owners/admins can restore marketing eligibility, and only after recording explicit new-consent source, time, evidence, and confirmation. Older skipped campaign recipients remain skipped.
9. Users sync/create approved Meta templates.
10. Users can target all eligible contacts, static lists, or saved dynamic AND/OR segments.
11. Campaign launch creates an immutable PostgreSQL recipient snapshot, then feeds a bounded BullMQ runway sized to phone throughput.
12. Send workers decrypt the correct tenant credential, enforce per-phone rate limits, and persist Meta `wamid` values.
13. Signed Meta webhooks update sent/delivered/read/failed states, process inbound STOP opt-outs, and power live campaign analytics.
14. Campaigns can be paused, resumed, or cancelled; suppression remains authoritative for future sends.
15. Database schema changes ship as committed Drizzle migrations and CI proves a clean PostgreSQL database can apply them before tests/build run.

## Platform administration

The web app includes a separate platform-owner control plane at `/admin`. Platform-admin access is independent of workspace roles such as owner/admin/member/viewer.

Access requires an authenticated, non-disabled user with an active platform-admin grant. The first administrator can be bootstrapped with `PLATFORM_ADMIN_USER_IDS` or a verified email listed in `PLATFORM_ADMIN_EMAILS`; the grant is then persisted in the database. A revoked database grant is not silently restored by bootstrap configuration.

Current platform-admin capabilities:

- **Overview:** view cross-organization counts for organizations, users, contacts, campaigns, recipients, connected WABAs/numbers, message delivery/read/failure totals, queue depth, webhook backlog, failed imports, and recent recipient errors.
- **Organizations:** search/filter organizations; inspect members, contacts, campaigns, WhatsApp numbers, imports, suppressions, message usage, billing, and organization audit history; suspend/reactivate an organization; edit its platform plan label and contact/campaign-recipient/monthly-message limits.
- **Workspace membership support:** change a membership role between `owner`, `admin`, `member`, and `viewer`, or remove a membership. Server-side guards prevent demoting or removing the last owner.
- **Users:** search/filter customer users, view their organization memberships, disable an account with a reason, and re-enable it.
- **Platform access:** grant, restore, and revoke platform-admin access for authentication users. An administrator cannot revoke their own active platform-admin grant.
- **Billing:** inspect subscriptions, invoices, payments, provider references, periods, and statuses. For **manually managed** subscriptions, admins can change the plan version or suspend billing. Provider-managed subscriptions are intentionally read-only in this control plane and must be changed through the selected billing provider.
- **WhatsApp connections:** inspect cross-organization WABA/phone identifiers, connection status, health, reconnect requirement, validation time, credential expiry, failure details, quality rating, and configured throughput.
- **Campaigns:** inspect recent campaigns and drill into failed recipient attempts, including attempt counts and provider/application errors.
- **Imports:** inspect recent, failed, and in-flight contact imports, row progress, imported/invalid/duplicate counts, and failure messages.
- **System queues:** inspect send, campaign-dispatch, contact-import, and webhook queue health and recent failed jobs. Direct retry is deliberately limited to failed **campaign-dispatch** and **contact-import** jobs; send recovery remains recipient-aware and webhook replay uses the durable webhook controls.
- **Webhooks:** search/filter the durable Meta webhook inbox, inspect payloads and processing state, and safely retry eligible unprocessed or dead-letter events.
- **Audit:** search/filter platform administrative mutations and export up to 5,000 matching audit events as CSV. The export action itself is audited.

All admin mutation handlers re-check platform-admin authorization server-side and record platform audit events. The current admin control plane does **not** provide user impersonation.

## Security and delivery baseline

- Application tenant IDs are separate from authentication-provider IDs.
- Meta app secrets never go to the browser.
- Client access tokens are encrypted with AES-256-GCM before database storage.
- A WhatsApp phone number cannot be attached to two workspaces.
- PostgreSQL remains the source of truth; Redis/BullMQ is an execution layer.
- Audience filters can only narrow opted-in, non-unsubscribed, non-suppressed contacts.
- Active suppression state is separate from append-only consent history, so restoring valid consent never erases an earlier opt-out.
- Campaign audience definitions are stored before dispatch so later segment edits cannot mutate an in-flight snapshot.
- Queue jobs contain credential references, not plaintext Meta tokens.
- Shared/staging/production databases are changed only by committed migrations, never `db:push`.

## Next production milestones

The source-of-truth launch and product-completeness checklist is [`docs/production-readiness-plan.md`](docs/production-readiness-plan.md). It tracks ownership, dependencies, acceptance criteria, evidence requirements, and verified completion for every readiness task.

Near-term priorities include real-provider Meta validation, representative load/soak evidence, production infrastructure and recovery proof, alerting, billing, and entitlement enforcement. Use the readiness plan rather than this summary to determine launch status.
