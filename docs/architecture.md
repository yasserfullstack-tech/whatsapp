# Architecture

## Goals

This platform is a multi-tenant SaaS. Each client owns its Meta Business / WhatsApp Business Account and phone number. The platform manages campaigns on the client's behalf after authorization.

The architecture is optimized for three things:

1. tenant isolation;
2. durable campaign state;
3. keeping Meta's per-number throughput saturated without exceeding it.

## Runtime layout

```text
Browser
  |
  v
Next.js web
  |
  v
Hono API ------------------> PostgreSQL (source of truth)
  |                              |
  |                              +-- organizations
  |                              +-- contacts / opt-in
  |                              +-- templates
  |                              +-- campaigns
  |                              +-- campaign recipients
  |                              +-- webhook events
  |
  +--> BullMQ / Valkey <---------+
           |
           +--> send workers --> per-phone token bucket --> Meta Cloud API
           |
           +--> webhook workers --> batch/status processing --> PostgreSQL

R2 is used for large CSV imports/exports and media-like artifacts, not primary transactional state.
```

## 500k-recipient campaigns

A 500,000-recipient campaign must never run in a browser or one HTTP request. The API creates a durable campaign and recipient snapshot in PostgreSQL. A dispatcher feeds pending recipients into BullMQ in batches. Workers consume immediately; enqueueing and sending overlap.

Meta is expected to be the main throughput constraint. The worker layer deliberately has much more queue/HTTP concurrency than the configured Meta messages-per-second limit. A Redis-backed token bucket is keyed by `phone_number_id`, so one client's 80 MPS number does not throttle another client's 1,000 MPS number.

The database, not Redis, is the source of truth. If Redis is rebuilt, pending recipient rows can be reconciled back into the queue without losing the campaign.

## Credentials

The `credential_key` stored with a phone number is a reference, not a secret. Production Meta tokens must be resolved from a secret manager or encrypted credential service. `META_ACCESS_TOKEN` exists only as a development/test bootstrap mechanism.

## Tenant isolation

Every high-volume business record carries `organization_id`. API authorization will always resolve the active organization from the authenticated membership rather than accepting a tenant id from the browser as authority. PostgreSQL RLS can be added as defense in depth after the auth model is wired.
