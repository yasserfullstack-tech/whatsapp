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
  web/       Next.js dashboard, auth, audiences, campaigns, Meta Embedded Signup BFF routes
  api/       Hono API + signed Meta webhook ingress
  worker/    contact import, campaign dispatch, send, and webhook workers
packages/
  auth/          Better Auth server configuration
  config/        validated runtime configuration
  credentials/   AES-256-GCM credential encryption helpers
  db/            Drizzle schema, audience predicates, and database client
  meta/          Meta Cloud API + Embedded Signup/webhook helpers
  queue/         BullMQ queues + per-phone limiter
  storage/       Cloudflare R2 / S3-compatible storage helpers
docs/
  architecture.md
  audiences.md
  r2.md
  webhooks.md
```

## Local development

Requirements: Bun 1.4.2+, Docker, and Docker Compose.

```bash
cp .env.example .env
bun install
bun run infra:up
bun run db:push
bun run dev
```

The web app runs on `http://localhost:3000` and the API defaults to `http://localhost:4000`.

`db:push` is for local development while the schema is still moving quickly. Before the first production deployment we will generate and commit versioned Drizzle migrations and deploy only through migrations.

## Required local secrets

At minimum, set these values in `.env`:

- `BETTER_AUTH_SECRET` — long random session secret.
- `CREDENTIAL_ENCRYPTION_KEY` — exactly 32 random bytes, base64 encoded (`openssl rand -base64 32`).
- `META_APP_ID` and `META_APP_SECRET` — the Meta app used by the platform.
- `META_CONFIG_ID` — the WhatsApp Embedded Signup configuration ID.
- `META_VERIFY_TOKEN` — private webhook verification value.
- Cloudflare R2 account, access key, secret, and bucket values for contact imports.

Never commit real Meta tokens or production secrets.

## Implemented flow

1. User creates an account or signs in and receives an internal workspace.
2. Meta Embedded Signup connects the client's own WABA and phone number.
3. The server exchanges the signup code, verifies the phone, subscribes the app, encrypts the tenant access token, and stores the connection.
4. CSV files upload directly from the browser to R2 and stream through background contact-import workers.
5. Imports normalize E.164 phone numbers, preserve consent metadata, deduplicate contacts, and can add valid contacts to reusable lists.
6. Users sync/create approved Meta templates.
7. Users can target all eligible contacts, static lists, or saved dynamic AND/OR segments.
8. Campaign launch creates an immutable PostgreSQL recipient snapshot, then feeds a bounded BullMQ runway sized to phone throughput.
9. Send workers decrypt the correct tenant credential, enforce per-phone rate limits, and persist Meta `wamid` values.
10. Signed Meta webhooks update sent/delivered/read/failed states, process inbound STOP opt-outs, and power live campaign analytics.
11. Campaigns can be paused, resumed, or cancelled; suppression remains authoritative for future sends.

## Security and delivery baseline

- Application tenant IDs are separate from authentication-provider IDs.
- Meta app secrets never go to the browser.
- Client access tokens are encrypted with AES-256-GCM before database storage.
- A WhatsApp phone number cannot be attached to two workspaces.
- PostgreSQL remains the source of truth; Redis/BullMQ is an execution layer.
- Audience filters can only narrow opted-in, non-unsubscribed, non-suppressed contacts.
- Campaign audience definitions are stored before dispatch so later segment edits cannot mutate an in-flight snapshot.
- Queue jobs contain credential references, not plaintext Meta tokens.

## Next production milestones

- suppression-management UI and an explicit resubscribe policy;
- committed versioned Drizzle migrations instead of production `db:push`;
- end-to-end tests with a real Meta test/business number;
- controlled 1k / 10k / 50k / large-volume load tests with PostgreSQL, Redis, worker, and Meta latency metrics;
- deployment hardening, monitoring, backups, and billing.
