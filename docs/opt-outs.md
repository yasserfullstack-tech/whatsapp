# Marketing opt-outs and campaign controls

## Inbound opt-outs

The Meta webhook worker recognizes exact, conservative marketing opt-out signals from inbound WhatsApp text messages and quick-reply buttons. Current signals include `STOP`, `STOP ALL`, `UNSUBSCRIBE`, `UNSUBSCRIBE ALL`, `STOP PROMOTIONS`, `STOP PROMOS`, `CANCEL`, `END`, and `QUIT` (case-insensitive). Button payloads use the same normalization, so values such as `STOP_PROMOTIONS` are recognized.

Ordinary text that merely contains one of these words is not treated as an opt-out. For example, `Please stop by tomorrow` does not suppress the contact.

When an opt-out is accepted, the worker:

1. upserts an organization-scoped `suppression_list` record that survives independently of the contact row;
2. appends an `opt_out` row to `contact_consent_events`, preserving the source message id and event time;
3. sets the matching contact to `opted_in = false` and records `unsubscribed_at`;
4. changes matching `pending` or `queued` campaign recipients to `skipped` with `SUPPRESSED` as the reason.

The raw signed Meta webhook remains in `webhook_events`, so there is an audit trail back to the source payload and inbound message id. The consent-event ledger is append-only and remains even if the active suppression is later cleared after valid new consent.

## Manual suppression

Workspace owners, admins, and members can manually suppress a contact from the Contacts page. Viewers are read-only. Manual suppression is organization-scoped and has the same delivery effect as a WhatsApp opt-out: the active suppression row is upserted, current marketing consent is cleared, and matching `pending` or `queued` campaign recipients are skipped.

Every manual action appends a `manual_suppression` consent event with the actor application-user id and operator-provided reason. Updating the active suppression never deletes historical consent events.

## Restoring marketing eligibility

A previous opt-out is not reversible with a generic “unsuppress” action. Only workspace owners and admins can restore eligibility, and the request must provide:

- a concrete source for the new marketing consent;
- the date/time the new consent was obtained;
- an evidence note describing where that consent is recorded and what the customer agreed to;
- explicit confirmation that this is new consent obtained after the prior opt-out/suppression.

The server then removes the active `suppression_list` row, sets the contact back to `opted_in = true`, records the new source/time on the contact, clears `unsubscribed_at`, and appends a `resubscribe` event to `contact_consent_events`.

Re-consent only changes eligibility for future campaign snapshots. It does not revive recipients that were already skipped in an older campaign, preserving campaign history and auditability.

## Race boundary

An HTTP request that has already been submitted to Meta cannot be recalled. An opt-out, manual suppression, or campaign cancellation prevents pending/queued recipients from being submitted, but a small number of requests already executing inside send workers may still complete. Keep the worker/queue runway bounded for this reason as well as memory usage.

## Pause and cancel

Pausing a campaign changes it to `paused`. The dispatcher stops adding new recipient jobs, while the small queue runway already reserved may drain. Resuming returns the campaign to `sending` and ensures a dispatcher job exists.

Cancelling changes the campaign to `cancelled` and atomically marks all `pending` and `queued` recipients as `skipped`. Existing BullMQ jobs become no-ops because the send worker only claims recipients that are still `pending` or `queued`.
