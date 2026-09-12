# Marketing opt-outs and campaign controls

## Inbound opt-outs

The Meta webhook worker recognizes exact, conservative marketing opt-out signals from inbound WhatsApp text messages and quick-reply buttons. Current signals include `STOP`, `STOP ALL`, `UNSUBSCRIBE`, `UNSUBSCRIBE ALL`, `STOP PROMOTIONS`, `STOP PROMOS`, `CANCEL`, `END`, and `QUIT` (case-insensitive). Button payloads use the same normalization, so values such as `STOP_PROMOTIONS` are recognized.

Ordinary text that merely contains one of these words is not treated as an opt-out. For example, `Please stop by tomorrow` does not suppress the contact.

When an opt-out is accepted, the worker:

1. upserts an organization-scoped `suppression_list` record that survives independently of the contact row;
2. sets the matching contact to `opted_in = false` and records `unsubscribed_at`;
3. changes matching `pending` or `queued` campaign recipients to `skipped` with `SUPPRESSED` as the reason.

The raw signed Meta webhook remains in `webhook_events`, so there is an audit trail back to the source payload and inbound message id.

## Race boundary

An HTTP request that has already been submitted to Meta cannot be recalled. An opt-out or campaign cancellation prevents pending/queued recipients from being submitted, but a small number of requests already executing inside send workers may still complete. Keep the worker/queue runway bounded for this reason as well as memory usage.

## Pause and cancel

Pausing a campaign changes it to `paused`. The dispatcher stops adding new recipient jobs, while the small queue runway already reserved may drain. Resuming returns the campaign to `sending` and ensures a dispatcher job exists.

Cancelling changes the campaign to `cancelled` and atomically marks all `pending` and `queued` recipients as `skipped`. Existing BullMQ jobs become no-ops because the send worker only claims recipients that are still `pending` or `queued`.
