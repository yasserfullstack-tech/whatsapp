# WhatsApp Marketing Platform

Multi-tenant SaaS for businesses to connect their own WhatsApp Business account, import opted-in contacts, manage approved templates, send large campaigns through Meta's WhatsApp Cloud API, and track delivery/read analytics.

## Stack

- Next.js 16.3.3 + React 19.3
- Bun 1.4.2
- TypeScript 7
- Hono API
- PostgreSQL + Drizzle ORM
- Better Auth (self-hosted sessions)
- BullMQ + Valkey/Redis
- Cloudflare R2 for large files (next milestone)
- Meta WhatsApp Cloud API / Embedded Signup

## Repository

```text
apps/
  web/       Next.js dashboard, auth, Meta Embedded Signup BFF routes
  api/       Hono API + Meta webhooks
  worker/    outbound send and webhook workers
packages/
  auth/          Better Auth server configuration
  config/        validated runtime configuration
  credentials/   AES-256-GCM credential encryption helpers
  db/            Drizzle schema and database client
  meta/          Meta Cloud API + Embedded Signup helpers
  queue/         BullMQ queues + per-phone limiter
docs/
  architecture.md
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

Never commit real Meta tokens or production secrets.

## Current user flow

1. User creates an account or signs in.
2. The platform creates an internal organization/workspace automatically.
3. The dashboard shows the workspace and its real WhatsApp connections.
4. The user clicks **Connect WhatsApp**.
5. Meta Embedded Signup opens and the user chooses their business/WABA/phone number.
6. The browser sends only the authorization code and returned IDs to our server.
7. The server exchanges the code with Meta, verifies the phone number, subscribes our app to the WABA, encrypts the access token, and saves the connection.
8. The dashboard refreshes with the connected number, quality status, and throughput.

## Security baseline

- Application tenant IDs are separate from authentication-provider IDs.
- Meta app secrets never go to the browser.
- Client access tokens are encrypted with AES-256-GCM before database storage.
- A WhatsApp phone number cannot be attached to two workspaces.
- PostgreSQL remains the source of truth; Redis/BullMQ is an execution layer.
- Only contacts with valid WhatsApp marketing consent should become campaign recipients.
- Opt-outs and suppression must be enforced before recipients are queued.

## Next milestone

Contact ingestion: direct browser upload to Cloudflare R2, background CSV parsing/normalization, deduplication, opt-in validation, import progress, and contact lists. After that: Meta template sync and the real campaign dispatcher/reconciliation path.
