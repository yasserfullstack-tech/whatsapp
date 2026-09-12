# WhatsApp Marketing Platform

Multi-tenant SaaS for businesses to connect their own WhatsApp Business account, import opted-in contacts, manage approved templates, send large campaigns through Meta's WhatsApp Cloud API, and track delivery/read analytics.

## Stack

- Next.js 16.3.3 + React 19.3
- Bun 1.4.2
- TypeScript 7
- Hono API
- PostgreSQL + Drizzle ORM
- BullMQ + Valkey/Redis
- Cloudflare R2 for large files (integration next)
- Meta WhatsApp Cloud API / Embedded Signup

## Repository

```text
apps/
  web/       Next.js dashboard
  api/       Hono API + Meta webhooks
  worker/    outbound send and webhook workers
packages/
  config/    validated runtime configuration
  db/        Drizzle schema and database client
  meta/      Meta WhatsApp Cloud API client
  queue/     BullMQ queues + per-phone rate limiter
docs/
  architecture.md
```

## Local development

Requirements: Bun 1.4.2+, Docker, and Docker Compose.

```bash
cp .env.example .env
docker compose up -d postgres valkey
bun install
bun run db:generate
bun run db:migrate
bun run dev
```

The web app runs on `http://localhost:3000` and the API defaults to `http://localhost:4000`.

## Current milestone

This bootstrap establishes the production shape of the system:

- dashboard shell;
- webhook verification/ingestion endpoint;
- campaign duration estimator;
- outbound BullMQ worker;
- Redis token-bucket rate limiter scoped by Meta phone number;
- Meta template-message client;
- initial multi-tenant database schema.

Authentication, Meta Embedded Signup, R2 imports, campaign dispatch/reconciliation, webhook persistence/status transitions, and billing are the next milestones.

## Safety / compliance baseline

Only contacts with valid WhatsApp marketing consent should be eligible for marketing campaigns. Opt-outs and suppression must be enforced before recipients are queued. Meta access tokens must never be committed to Git or stored as plain text in application tables.
