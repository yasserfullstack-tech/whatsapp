import { createHmac, timingSafeEqual } from "node:crypto";
import {
  BaseBillingProvider,
  BillingProviderCapabilityError,
  type BillingProviderCapabilities,
  type BillingProviderCheckout,
  type BillingProviderCustomer,
  type BillingProviderPortalSession,
  type BillingProviderRefund,
  type BillingProviderSubscription,
  type BillingProviderWebhookEvent,
} from "./provider";

type FetchLike = typeof globalThis.fetch;
type StripeObject = Record<string, unknown>;

export type StripeBillingProviderConfig = {
  secretKey: string;
  webhookSecret?: string;
  apiBaseUrl?: string;
  webhookToleranceSeconds?: number;
  fetchImpl?: FetchLike;
  now?: () => Date;
};

const capabilities: BillingProviderCapabilities = {
  customer: true,
  checkout: true,
  subscriptions: true,
  planChanges: true,
  cancellation: true,
  portal: true,
  webhooks: true,
  payments: false,
  refunds: true,
};

function asRecord(value: unknown): StripeObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as StripeObject : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function idFrom(value: unknown): string | null {
  const direct = asString(value);
  if (direct) return direct;
  return asString(asRecord(value)?.id);
}

function appendMetadata(body: URLSearchParams, prefix: string, metadata?: Record<string, string>): void {
  for (const [key, value] of Object.entries(metadata ?? {})) {
    body.append(`${prefix}[${key}]`, value);
  }
}

function safeEqualHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right)) return false;
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseSignatureHeader(value: string): { timestamp: number; signatures: string[] } {
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const segment of value.split(",")) {
    const [key, rawValue] = segment.trim().split("=", 2);
    if (key === "t") timestamp = Number.parseInt(rawValue ?? "", 10);
    if (key === "v1" && rawValue) signatures.push(rawValue);
  }
  if (!timestamp || !Number.isFinite(timestamp) || signatures.length === 0) {
    throw new Error("Invalid Stripe webhook signature header");
  }
  return { timestamp, signatures };
}

export class StripeBillingProvider extends BaseBillingProvider {
  readonly key = "stripe";
  readonly capabilities = capabilities;

  private readonly apiBaseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;
  private readonly webhookToleranceSeconds: number;

  constructor(private readonly config: StripeBillingProviderConfig) {
    super();
    if (!config.secretKey) throw new Error("Stripe secret key is required");
    this.apiBaseUrl = (config.apiBaseUrl ?? "https://api.stripe.com").replace(/\/$/, "");
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
    this.now = config.now ?? (() => new Date());
    this.webhookToleranceSeconds = config.webhookToleranceSeconds ?? 300;
  }

  private async request(path: string, input?: {
    method?: "GET" | "POST" | "DELETE";
    body?: URLSearchParams;
    idempotencyKey?: string;
  }): Promise<StripeObject> {
    const response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
      method: input?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${this.config.secretKey}`,
        ...(input?.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        ...(input?.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}),
      },
      body: input?.body?.toString(),
    });
    const payload = asRecord(await response.json().catch(() => null));
    if (!response.ok) {
      const error = asRecord(payload?.error);
      const message = asString(error?.message) ?? `Stripe request failed with status ${response.status}`;
      throw new Error(message);
    }
    if (!payload) throw new Error("Stripe returned an invalid JSON response");
    return payload;
  }

  async createCustomer(input: {
    organizationId: string;
    email?: string;
    name?: string;
    metadata?: Record<string, string>;
  }): Promise<BillingProviderCustomer> {
    const body = new URLSearchParams();
    if (input.email) body.set("email", input.email);
    if (input.name) body.set("name", input.name);
    body.set("metadata[organizationId]", input.organizationId);
    appendMetadata(body, "metadata", input.metadata);
    const customer = await this.request("/v1/customers", {
      method: "POST",
      body,
      idempotencyKey: `customer:${input.organizationId}`,
    });
    const externalId = asString(customer.id);
    if (!externalId) throw new Error("Stripe customer response is missing id");
    return { externalId, raw: customer };
  }

  async createCheckout(input: {
    organizationId: string;
    customerExternalId?: string;
    planExternalRef?: string;
    successUrl: string;
    cancelUrl: string;
    metadata?: Record<string, string>;
  }): Promise<BillingProviderCheckout> {
    if (!input.planExternalRef) throw new Error("Stripe Checkout requires a Price ID");
    const body = new URLSearchParams({
      mode: "subscription",
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.organizationId,
      "line_items[0][price]": input.planExternalRef,
      "line_items[0][quantity]": "1",
      "metadata[organizationId]": input.organizationId,
      "subscription_data[metadata][organizationId]": input.organizationId,
    });
    if (input.customerExternalId) body.set("customer", input.customerExternalId);
    appendMetadata(body, "metadata", input.metadata);
    appendMetadata(body, "subscription_data[metadata]", input.metadata);
    const session = await this.request("/v1/checkout/sessions", {
      method: "POST",
      body,
      idempotencyKey: `checkout:${input.organizationId}:${input.planExternalRef}`,
    });
    const externalId = asString(session.id);
    const url = asString(session.url);
    if (!externalId || !url) throw new Error("Stripe Checkout response is missing id or url");
    return { externalId, url, raw: session };
  }

  async createSubscription(input: {
    organizationId: string;
    customerExternalId: string;
    planExternalRef: string;
    metadata?: Record<string, string>;
  }): Promise<BillingProviderSubscription> {
    const body = new URLSearchParams({
      customer: input.customerExternalId,
      "items[0][price]": input.planExternalRef,
      "metadata[organizationId]": input.organizationId,
      payment_behavior: "default_incomplete",
    });
    appendMetadata(body, "metadata", input.metadata);
    const subscription = await this.request("/v1/subscriptions", {
      method: "POST",
      body,
      idempotencyKey: `subscription:${input.organizationId}:${input.planExternalRef}`,
    });
    const externalId = asString(subscription.id);
    if (!externalId) throw new Error("Stripe subscription response is missing id");
    return { externalId, status: asString(subscription.status) ?? "unknown", raw: subscription };
  }

  async changePlan(input: {
    subscriptionExternalId: string;
    planExternalRef: string;
    effectiveAt?: Date;
  }): Promise<BillingProviderSubscription> {
    if (input.effectiveAt && input.effectiveAt.getTime() > this.now().getTime() + 60_000) {
      throw new BillingProviderCapabilityError(this.key, "scheduled plan changes");
    }
    const current = await this.request(`/v1/subscriptions/${encodeURIComponent(input.subscriptionExternalId)}`);
    const items = asRecord(current.items)?.data;
    const firstItem = Array.isArray(items) ? asRecord(items[0]) : null;
    const itemId = asString(firstItem?.id);
    if (!itemId) throw new Error("Stripe subscription has no mutable subscription item");

    const body = new URLSearchParams({
      "items[0][id]": itemId,
      "items[0][price]": input.planExternalRef,
      proration_behavior: "create_prorations",
    });
    const subscription = await this.request(`/v1/subscriptions/${encodeURIComponent(input.subscriptionExternalId)}`, {
      method: "POST",
      body,
      idempotencyKey: `plan-change:${input.subscriptionExternalId}:${input.planExternalRef}`,
    });
    return {
      externalId: asString(subscription.id) ?? input.subscriptionExternalId,
      status: asString(subscription.status) ?? "unknown",
      raw: subscription,
    };
  }

  async cancelSubscription(input: {
    subscriptionExternalId: string;
    atPeriodEnd?: boolean;
  }): Promise<BillingProviderSubscription> {
    const path = `/v1/subscriptions/${encodeURIComponent(input.subscriptionExternalId)}`;
    const subscription = input.atPeriodEnd === false
      ? await this.request(path, { method: "DELETE" })
      : await this.request(path, {
          method: "POST",
          body: new URLSearchParams({ cancel_at_period_end: "true" }),
          idempotencyKey: `cancel:${input.subscriptionExternalId}:period-end`,
        });
    return {
      externalId: asString(subscription.id) ?? input.subscriptionExternalId,
      status: asString(subscription.status) ?? "unknown",
      raw: subscription,
    };
  }

  async createBillingPortal(input: {
    customerExternalId: string;
    returnUrl: string;
  }): Promise<BillingProviderPortalSession> {
    const body = new URLSearchParams({ customer: input.customerExternalId, return_url: input.returnUrl });
    const session = await this.request("/v1/billing_portal/sessions", { method: "POST", body });
    const externalId = asString(session.id);
    const url = asString(session.url);
    if (!externalId || !url) throw new Error("Stripe portal response is missing id or url");
    return { externalId, url, raw: session };
  }

  async verifyWebhook(input: {
    headers: Record<string, string | undefined>;
    rawBody: string;
  }): Promise<BillingProviderWebhookEvent> {
    if (!this.config.webhookSecret) throw new Error("Stripe webhook secret is required");
    const signatureHeader = input.headers["stripe-signature"]
      ?? input.headers["Stripe-Signature"]
      ?? Object.entries(input.headers).find(([key]) => key.toLowerCase() === "stripe-signature")?.[1];
    if (!signatureHeader) throw new Error("Stripe-Signature header is required");

    const { timestamp, signatures } = parseSignatureHeader(signatureHeader);
    const ageSeconds = Math.abs(Math.floor(this.now().getTime() / 1000) - timestamp);
    if (ageSeconds > this.webhookToleranceSeconds) throw new Error("Stripe webhook timestamp is outside tolerance");

    const expected = createHmac("sha256", this.config.webhookSecret)
      .update(`${timestamp}.${input.rawBody}`, "utf8")
      .digest("hex");
    if (!signatures.some((signature) => safeEqualHex(signature, expected))) {
      throw new Error("Invalid Stripe webhook signature");
    }

    const raw = asRecord(JSON.parse(input.rawBody));
    const externalEventId = asString(raw?.id);
    const type = asString(raw?.type);
    const data = asRecord(asRecord(raw?.data)?.object);
    if (!raw || !externalEventId || !type || !data) throw new Error("Stripe webhook payload is invalid");
    const created = typeof raw.created === "number" ? raw.created : Math.floor(this.now().getTime() / 1000);
    return {
      externalEventId,
      type,
      occurredAt: new Date(created * 1000),
      data,
      raw,
    };
  }

  async refundPayment(input: {
    paymentExternalId: string;
    amountMinor?: number;
    reason?: string;
  }): Promise<BillingProviderRefund> {
    const body = new URLSearchParams();
    if (input.paymentExternalId.startsWith("ch_")) body.set("charge", input.paymentExternalId);
    else body.set("payment_intent", input.paymentExternalId);
    if (input.amountMinor !== undefined) body.set("amount", String(input.amountMinor));
    if (input.reason && ["duplicate", "fraudulent", "requested_by_customer"].includes(input.reason)) {
      body.set("reason", input.reason);
    }
    const refund = await this.request("/v1/refunds", {
      method: "POST",
      body,
      idempotencyKey: `refund:${input.paymentExternalId}:${input.amountMinor ?? "full"}`,
    });
    const externalId = asString(refund.id);
    if (!externalId) throw new Error("Stripe refund response is missing id");
    return { externalId, status: asString(refund.status) ?? "unknown", raw: refund };
  }
}
