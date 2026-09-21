# Stripe billing provider

PR-006 uses Stripe Billing as the concrete online billing provider behind the provider-neutral `@wa/billing` contract.

## Provider configuration

Create recurring Stripe Prices for the Growth and Scale SaaS plans and configure these deployment secrets:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_GROWTH`
- `STRIPE_PRICE_SCALE`
- `BILLING_FAILED_PAYMENT_GRACE_DAYS` (defaults to `7`)

The application intentionally does not hard-code subscription amounts. Stripe Price IDs are deployment configuration and Stripe remains the source of truth for the charged amount. On the first verified subscription webhook, the configured Price ID is also persisted to the existing `plan_versions.provider_price_ref` field for reconciliation.

A plan version is an immutable billing snapshot. Once `provider_price_ref` is bound, do not repoint that version to a different Stripe Price. Create a new plan version first, then update the corresponding `STRIPE_PRICE_*` deployment value. The online billing action rejects a configured Price that conflicts with the latest plan version's persisted provider reference.

Configure the Stripe webhook endpoint as:

```text
https://<APP_DOMAIN>/api/billing/webhook
```

The endpoint must receive the following event families:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.created`
- `invoice.updated`
- `invoice.finalized`
- `invoice.paid`
- `invoice.payment_succeeded`
- `invoice.payment_failed`
- `invoice.voided`
- `invoice.marked_uncollectible`
- `charge.refunded`
- `refund.created`
- `refund.updated`

## Lifecycle behavior

1. A workspace owner/admin selects Growth or Scale.
2. A workspace without a Stripe subscription gets a Stripe Customer and hosted Checkout Session.
3. A workspace with an active Stripe subscription changes the existing subscription item Price; Stripe computes prorations.
4. Signed Stripe webhooks update the local subscription, plan version, period dates, invoices, payments, and refunds.
5. `past_due` / `invoice.payment_failed` enters the configured grace period. Stripe `unpaid` or `paused` state suspends the subscription.
6. Successful payment clears a payment-related grace state.
7. Cancellation is scheduled at the current period end; Customer Portal is also available for payment-method, invoice, and subscription management.

Local entitlements continue to resolve exclusively from the local billing model. Provider webhooks synchronize that model; application authorization never calls Stripe in the request path.

## Webhook security and replay handling

`Stripe-Signature` is verified using HMAC-SHA256 over Stripe's exact `<timestamp>.<raw-body>` signed payload with a five-minute default tolerance. The route reads `request.text()` before JSON parsing so the body is not altered prior to verification.

Every verified provider event is appended to `billing_provider_events` using `(provider_key, external_event_id)` as the unique replay key. Processing obtains a row lock and only marks `processed_at` after all lifecycle changes commit. A failed handler leaves the event unprocessed so a Stripe retry can safely resume it; an already processed retry is acknowledged without applying side effects again.

Stripe does not guarantee webhook delivery order. Subscription and invoice snapshot events are therefore reconciled against the provider's current subscription/invoice object before local state is projected. This prevents a delayed older snapshot from rolling a paid invoice back to failed state or moving a subscription back to an older plan/status. Event IDs remain the replay key; provider hydration is for current-state reconciliation, not for duplicate detection.

Checkout creation uses a short deterministic idempotency window per workspace and target Price so immediate retries/double-submits reuse the same Stripe Checkout creation request. The webhook synchronizer also refuses to replace a workspace's existing non-cancelled Stripe subscription with a different active Stripe subscription ID. Conflicting events remain unprocessed for operator investigation rather than silently rebinding the local workspace.

## Refunds

The provider adapter supports full or partial refunds through Stripe PaymentIntent/Charge references. Refund synchronization treats `charge.refunded.amount_refunded` as the authoritative cumulative refunded amount when available and records successful individual refund amounts by refund ID. The local total is monotonic and capped at the original payment amount, so duplicate or out-of-order `refund.created` / `refund.updated` events cannot reduce the already-observed cumulative refund state. Pending/failed individual refund objects do not mark the payment refunded. Product/support policy determines when an authorized operator should issue a refund.

## Test-mode release verification

Before enabling paid production traffic, capture redacted evidence for one Stripe test-mode workspace:

1. Starter -> Growth Checkout completes.
2. `checkout.session.completed`, subscription, and invoice/payment webhooks return HTTP 200.
3. Local plan/status/period and invoice/payment rows match Stripe.
4. Growth -> Scale and Scale -> Growth both synchronize after webhook delivery.
5. Customer Portal opens and payment details/invoices are visible.
6. A test payment failure enters grace and a subsequent successful retry restores active state.
7. Cancellation-at-period-end is reflected locally.
8. Re-sending the same Stripe event leaves exactly one provider-event row and does not duplicate subscription changes/payments.
9. A partial refund followed by another refund updates the local cumulative refund state correctly; re-deliver the individual refund events out of order and confirm the total does not regress.
10. Rapidly retry the initial Checkout action and confirm Stripe creates/reuses one Checkout request within the retry window rather than producing multiple subscriptions.
11. Re-deliver an older invoice/subscription snapshot after a newer provider state exists and confirm the local state remains aligned with Stripe's current resource.

Do not include Stripe secret keys, webhook secrets, customer email addresses, or full customer/payment identifiers in evidence.

## Provider references

- Checkout subscriptions: https://docs.stripe.com/payments/checkout/build-subscriptions
- Modify subscriptions: https://docs.stripe.com/billing/subscriptions/change
- Customer Portal: https://docs.stripe.com/customer-management
- Webhook signature verification: https://docs.stripe.com/webhooks/signature
- Webhooks and delivery behavior: https://docs.stripe.com/webhooks
- Event types: https://docs.stripe.com/api/events/types
- Refunds: https://docs.stripe.com/refunds
