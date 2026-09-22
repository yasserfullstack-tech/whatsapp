# Billing provider integration

The application currently has **no concrete online payment provider selected**.

The provider-neutral billing model remains in place so the product can keep plan, entitlement, invoice, payment, and subscription records without coupling application authorization to a payment vendor.

## Current behavior

- Online checkout is disabled.
- No payment-provider customer portal is exposed.
- No payment-provider webhook endpoint is registered by the application.
- Billing can still be managed manually by platform administrators.
- Entitlements continue to resolve from the local billing model.
- Existing provider reference columns remain generic so a future integration does not require a database redesign.

## Selecting a provider later

When a provider is chosen, implement it behind the `BillingProvider` contract in `packages/billing/src/provider.ts` rather than embedding vendor-specific calls throughout the app.

A production integration should define, test, and document the capabilities it actually supports, including whichever of these are required:

- customer creation;
- hosted or embedded checkout;
- subscription creation and plan changes;
- cancellation;
- billing portal or payment-method management;
- signed webhook verification and replay protection;
- payment recording;
- refunds.

Provider credentials and webhook secrets should only be added after the provider is selected. Do not add placeholder secrets for an unselected vendor.

## Release verification

Before online paid traffic is enabled, verify the selected provider end to end in its test or sandbox environment. At minimum, cover initial purchase, plan changes, cancellation, failed-payment recovery where applicable, replay-safe webhook processing, invoice/payment synchronization, and refunds if supported.

Keep product authorization dependent on the local entitlement model, not on synchronous provider API calls in normal request paths.
