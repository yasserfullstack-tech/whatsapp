import { createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { StripeBillingProvider } from "./stripe-provider";

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("StripeBillingProvider", () => {
  test("creates customers and subscription Checkout sessions with workspace metadata", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith("/v1/customers")) return jsonResponse({ id: "cus_123" });
      if (url.endsWith("/v1/checkout/sessions")) return jsonResponse({ id: "cs_123", url: "https://checkout.stripe.test/session" });
      throw new Error(`Unexpected request ${url}`);
    }) as typeof fetch;
    const provider = new StripeBillingProvider({ secretKey: "sk_test_123", fetchImpl });

    const customer = await provider.createCustomer({
      organizationId: "org_123",
      email: "owner@example.com",
    });
    const checkout = await provider.createCheckout({
      organizationId: "org_123",
      customerExternalId: customer.externalId,
      planExternalRef: "price_growth",
      successUrl: "https://app.test/success",
      cancelUrl: "https://app.test/cancel",
      metadata: { planCode: "growth" },
    });

    expect(customer).toMatchObject({ providerKey: "stripe", externalId: "cus_123" });
    expect(checkout).toMatchObject({ providerKey: "stripe", url: "https://checkout.stripe.test/session" });
    const checkoutBody = String(requests[1]?.init?.body);
    expect(checkoutBody).toContain("mode=subscription");
    expect(checkoutBody).toContain("line_items%5B0%5D%5Bprice%5D=price_growth");
    expect(checkoutBody).toContain("metadata%5BorganizationId%5D=org_123");
    expect(checkoutBody).toContain("subscription_data%5Bmetadata%5D%5BorganizationId%5D=org_123");
  });

  test("changes plan, schedules cancellation, opens portal, and refunds", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith("/v1/subscriptions/sub_123") && (!init?.method || init.method === "GET")) {
        return jsonResponse({ id: "sub_123", status: "active", items: { data: [{ id: "si_123" }] } });
      }
      if (url.endsWith("/v1/subscriptions/sub_123")) return jsonResponse({ id: "sub_123", status: "active" });
      if (url.endsWith("/v1/billing_portal/sessions")) return jsonResponse({ id: "bps_123", url: "https://billing.stripe.test/session" });
      if (url.endsWith("/v1/refunds")) return jsonResponse({ id: "re_123", status: "succeeded", amount: 500 });
      throw new Error(`Unexpected request ${url}`);
    }) as typeof fetch;
    const provider = new StripeBillingProvider({ secretKey: "sk_test_123", fetchImpl });

    await provider.changePlan({ subscriptionExternalId: "sub_123", planExternalRef: "price_scale" });
    await provider.cancelSubscription({ subscriptionExternalId: "sub_123", atPeriodEnd: true });
    const portal = await provider.createBillingPortal({ customerExternalId: "cus_123", returnUrl: "https://app.test/billing" });
    const refund = await provider.refundPayment({ paymentExternalId: "pi_123", amountMinor: 500, reason: "requested_by_customer" });

    expect(String(requests[1]?.init?.body)).toContain("items%5B0%5D%5Bid%5D=si_123");
    expect(String(requests[1]?.init?.body)).toContain("items%5B0%5D%5Bprice%5D=price_scale");
    expect(String(requests[2]?.init?.body)).toBe("cancel_at_period_end=true");
    expect(portal.url).toBe("https://billing.stripe.test/session");
    expect(refund).toMatchObject({ providerKey: "stripe", externalId: "re_123", paymentExternalId: "pi_123", amountMinor: 500 });
    expect(String(requests[4]?.init?.body)).toContain("payment_intent=pi_123");
  });

  test("verifies signed webhook payloads and rejects tampering", async () => {
    const now = new Date("2026-09-16T10:00:00.000Z");
    const timestamp = Math.floor(now.getTime() / 1000);
    const secret = "whsec_test_123";
    const rawBody = JSON.stringify({
      id: "evt_123",
      type: "customer.subscription.updated",
      created: timestamp,
      data: { object: { id: "sub_123", status: "active" } },
    });
    const signature = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
    const provider = new StripeBillingProvider({
      secretKey: "sk_test_123",
      webhookSecret: secret,
      now: () => now,
    });

    const event = await provider.verifyWebhook({
      headers: { "stripe-signature": `t=${timestamp},v1=${signature}` },
      rawBody,
    });
    expect(event).toMatchObject({
      providerKey: "stripe",
      externalId: "evt_123",
      eventType: "customer.subscription.updated",
      verified: true,
    });

    await expect(provider.verifyWebhook({
      headers: { "stripe-signature": `t=${timestamp},v1=${signature}` },
      rawBody: `${rawBody} `,
    })).rejects.toThrow("Invalid Stripe webhook signature");
  });
});
