# Campaign engine

Campaigns are designed for audiences of hundreds of thousands of opted-in contacts without making Redis the source of truth.

## Lifecycle

1. The web app validates a connected phone number and an approved template from the same WABA.
2. A lightweight campaign row is created and a `campaign-dispatch` BullMQ job is queued.
3. The dispatcher creates the recipient snapshot in PostgreSQL with one `INSERT ... SELECT`. Only opted-in, non-unsubscribed contacts are included.
4. The dispatcher keeps a bounded queue runway instead of pushing the entire audience into Redis. The target runway is approximately 15 seconds of the phone number's current throughput, capped at 20,000 queued recipients per campaign.
5. Send workers claim queued recipients, use the distributed per-number token bucket, call Meta, and persist the returned `wamid` as `submitted`.
6. Meta webhooks later advance `submitted` recipients through `sent`, `delivered`, `read`, or `failed`.

## 500k behavior

At 1,000 MPS the dispatcher aims to keep about 15,000 send jobs ready. At 80 MPS it keeps about 1,200. The first 1,000-recipient batch is enqueued immediately after snapshot creation, so message sending starts while later recipients remain only in PostgreSQL.

This avoids a 500,000-job Redis spike and keeps queue memory roughly proportional to throughput rather than audience size.

## Durability and recovery

PostgreSQL owns campaign and recipient state. Queue jobs are disposable execution records. A periodic reconciliation loop:

- resets recipients that have been `queued` for an abnormally long time without a `wamid`;
- ensures every `dispatching`/`sending` campaign has a dispatcher job;
- allows Redis to be rebuilt without losing the campaign snapshot.

The `(campaign_id, contact_id)` unique constraint prevents duplicate snapshot recipients, and BullMQ job IDs are derived from recipient IDs to suppress normal re-enqueue duplication.

There is one unavoidable distributed-systems edge case: if Meta accepts a request but the worker loses the HTTP response before the returned `wamid` is persisted, a retry can potentially send the template again because the Cloud API does not expose a client-provided idempotency key for this send operation. We minimize that window and retain attempt metadata for audit/reconciliation.
