# Campaign engine

Campaigns are designed for audiences of hundreds of thousands of opted-in contacts without making Redis the source of truth.

## Lifecycle

1. The web app validates a connected phone number and an approved template from the same WABA.
2. An immediate campaign is created as `dispatching` and a `campaign-dispatch` BullMQ job is queued. A scheduled campaign is created as `scheduled` and remains only in PostgreSQL until it is due.
3. The dispatcher creates the recipient snapshot in PostgreSQL with one `INSERT ... SELECT`. Only opted-in, non-unsubscribed contacts are included.
4. The dispatcher keeps a bounded queue runway instead of pushing the entire audience into Redis. The target runway is approximately 15 seconds of the phone number's current throughput, capped at 20,000 queued recipients per campaign.
5. Send workers claim queued recipients, use the distributed per-number token bucket, call Meta, and persist the returned `wamid` as `submitted`.
6. Meta webhooks later advance `submitted` recipients through `sent`, `delivered`, `read`, or `failed`.

## Scheduling contract

`campaigns.scheduled_at` is a PostgreSQL `timestamptz` and therefore represents one absolute instant. The campaign UI treats the `datetime-local` value as wall-clock time in the workspace timezone from `workspace_preferences.timezone`, converts it to an ISO-8601 instant, and sends that instant to the API. The API requires an explicit `Z` or numeric offset and rejects schedule instants that are not in the future.

The workspace timezone controls schedule entry and display; it does not change the persisted instant. If the workspace timezone setting is changed later, an already scheduled campaign still dispatches at the same instant and is simply rendered in the new workspace timezone. DST gaps are rejected rather than silently shifted. If a wall-clock time occurs twice during a DST fall-back overlap, the converter deterministically chooses the earlier matching instant.

Scheduled campaigns are not placed in Redis early. Worker reconciliation atomically claims campaigns whose `scheduled_at <= now()` by changing `scheduled -> dispatching` with a compare-and-set update. Multiple workers may observe the same due row, but only one can claim it. The normal reconciliation path then publishes a dispatcher job with the deterministic campaign job ID. A stale or forged dispatch job that reaches the worker while the campaign is still `scheduled` is deferred without creating recipients or sending messages.

Audience membership is snapshotted **at dispatch time**, not schedule creation time. The eligible-contact count shown while scheduling is an estimate using current consent and suppression state; contacts that opt out before dispatch are excluded, while contacts that become eligible before dispatch may be included according to the saved audience definition.

Cancellation and rescheduling are allowed only while the campaign is still `scheduled`. Both operations use a conditional update on that state. Once reconciliation has claimed the row as `dispatching`, a concurrent cancel/reschedule request receives a conflict instead of racing message dispatch.

## 500k behavior

At 1,000 MPS the dispatcher aims to keep about 15,000 send jobs ready. At 80 MPS it keeps about 1,200. The first 1,000-recipient batch is enqueued immediately after snapshot creation, so message sending starts while later recipients remain only in PostgreSQL.

This avoids a 500,000-job Redis spike and keeps queue memory roughly proportional to throughput rather than audience size.

## Durability and recovery

PostgreSQL owns campaign and recipient state, including campaign schedules. Queue jobs are disposable execution records. A periodic reconciliation loop:

- atomically claims due `scheduled` campaigns as `dispatching`;
- resets recipients that have been `queued` for an abnormally long time without a `wamid`;
- ensures every `dispatching`/`sending` campaign has a dispatcher job;
- allows Redis to be rebuilt without losing a campaign schedule or recipient snapshot.

The `(campaign_id, contact_id)` unique constraint prevents duplicate snapshot recipients, scheduled rows use a compare-and-set claim to prevent duplicate scheduler ownership, and BullMQ job IDs are derived from campaign/recipient IDs to suppress normal re-enqueue duplication.

There is one unavoidable distributed-systems edge case: if Meta accepts a request but the worker loses the HTTP response before the returned `wamid` is persisted, a retry can potentially send the template again because the Cloud API does not expose a client-provided idempotency key for this send operation. We minimize that window and retain attempt metadata for audit/reconciliation.
