# Meta webhook processing

The public callback is `GET/POST /api/v1/meta/webhook` on the API service.

## Ingress guarantees

The GET route handles Meta's verification challenge using `META_VERIFY_TOKEN`.

POST requests are accepted only when `X-Hub-Signature-256` matches an HMAC-SHA256 of the raw request body using `META_APP_SECRET`. The raw JSON payload is then persisted to PostgreSQL before a processing job is queued. The API returns HTTP 200 only after both persistence and queueing succeed.

`webhook_events.event_key` is a SHA-256 hash of the exact request body. Meta retries of the same payload therefore reuse the persisted event instead of creating duplicate rows. If PostgreSQL succeeds but Redis is temporarily unavailable, the endpoint returns 503; Meta's retry will find the same unprocessed database event and try to queue it again.

## Worker processing

The webhook queue carries only the persisted event UUID, not the full Meta payload. Workers reload the raw payload from PostgreSQL and apply tracked outgoing message statuses by `wamid`:

```text
submitted -> sent -> delivered -> read
                  \
                   -> failed
```

Meta documents that status notifications can arrive out of order. Updates are therefore monotonic: a late `sent` event cannot regress a recipient already marked `delivered` or `read`, and a late `delivered` event cannot regress `read`. Failed status does not overwrite a recipient that is already delivered/read.

The worker records Meta's status timestamp in `sent_at`, `delivered_at`, `read_at`, or `failed_at`. Failure code/details are copied into the recipient's existing error fields. After every status in the raw payload is applied, `webhook_events.processed_at` is set. A worker crash before that point causes BullMQ to retry; all transitions are idempotent.

## Scale and retention

One accepted campaign message may later produce sent, delivered, and read callbacks. Large campaigns can therefore create millions of webhook status updates. `campaign_recipients.wamid` is unique and indexed so each status update is an indexed point update instead of a campaign scan.

Raw webhook rows are useful for support and reconciliation, but they should not be retained forever. Before production, add a retention/partitioning policy that matches the product's audit requirements (for example, keep raw webhook payloads for 30-90 days while retaining normalized campaign status history longer).

Official Meta reference: https://www.postman.com/meta/whatsapp-business-platform/folder/vzaxn16/webhook-payload-reference
