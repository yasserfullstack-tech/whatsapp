export type BillingProviderCapabilities = {
  customer: boolean;
  checkout: boolean;
  subscriptions: boolean;
  planChanges: boolean;
  cancellation: boolean;
  portal: boolean;
  webhooks: boolean;
  payments: boolean;
  refunds: boolean;
};

export type ProviderReference = {
  providerKey: string;
  externalId: string;
};

export type BillingProviderCustomer = ProviderReference & {
  email?: string;
};

export type BillingProviderCheckout = ProviderReference & {
  url: string;
  expiresAt?: Date;
};

export type BillingProviderSubscription = ProviderReference & {
  status: string;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
};

export type BillingProviderPortal = {
  url: string;
  expiresAt?: Date;
};

export type BillingProviderWebhookEvent = ProviderReference & {
  eventType: string;
  verified: boolean;
  payload: unknown;
};

export type BillingProviderPayment = ProviderReference & {
  amountMinor: number;
  currency: string;
  status: string;
};

export type BillingProviderRefund = ProviderReference & {
  paymentExternalId: string;
  amountMinor: number;
  status: string;
};

export class BillingProviderCapabilityError extends Error {
  constructor(providerKey: string, capability: keyof BillingProviderCapabilities) {
    super(`Billing provider ${providerKey} does not support ${capability}`);
    this.name = "BillingProviderCapabilityError";
  }
}

export interface BillingProvider {
  readonly key: string;
  readonly capabilities: BillingProviderCapabilities;

  createCustomer(input: {
    organizationId: string;
    email?: string;
    name?: string;
    metadata?: Record<string, unknown>;
  }): Promise<BillingProviderCustomer>;

  createCheckout(input: {
    organizationId: string;
    customerExternalId?: string;
    planExternalRef?: string;
    successUrl: string;
    cancelUrl: string;
    idempotencyKey?: string;
    expiresAt?: Date;
    metadata?: Record<string, unknown>;
  }): Promise<BillingProviderCheckout>;

  createSubscription(input: {
    organizationId: string;
    customerExternalId: string;
    planExternalRef: string;
    metadata?: Record<string, unknown>;
  }): Promise<BillingProviderSubscription>;

  changePlan(input: {
    subscriptionExternalId: string;
    planExternalRef: string;
    effectiveAt?: Date;
  }): Promise<BillingProviderSubscription>;

  cancelSubscription(input: {
    subscriptionExternalId: string;
    atPeriodEnd?: boolean;
  }): Promise<BillingProviderSubscription>;

  createBillingPortal(input: {
    customerExternalId: string;
    returnUrl: string;
  }): Promise<BillingProviderPortal>;

  verifyWebhook(input: {
    headers: Headers | Record<string, string>;
    rawBody: string;
  }): Promise<BillingProviderWebhookEvent>;

  recordPayment(input: {
    organizationId: string;
    invoiceExternalId?: string;
    amountMinor: number;
    currency: string;
    metadata?: Record<string, unknown>;
  }): Promise<BillingProviderPayment>;

  refundPayment(input: {
    paymentExternalId: string;
    amountMinor?: number;
    reason?: string;
  }): Promise<BillingProviderRefund>;
}

export abstract class BaseBillingProvider implements BillingProvider {
  abstract readonly key: string;
  abstract readonly capabilities: BillingProviderCapabilities;

  protected unsupported(capability: keyof BillingProviderCapabilities): never {
    throw new BillingProviderCapabilityError(this.key, capability);
  }

  async createCustomer(_input: Parameters<BillingProvider["createCustomer"]>[0]): Promise<BillingProviderCustomer> {
    return this.unsupported("customer");
  }

  async createCheckout(_input: Parameters<BillingProvider["createCheckout"]>[0]): Promise<BillingProviderCheckout> {
    return this.unsupported("checkout");
  }

  async createSubscription(_input: Parameters<BillingProvider["createSubscription"]>[0]): Promise<BillingProviderSubscription> {
    return this.unsupported("subscriptions");
  }

  async changePlan(_input: Parameters<BillingProvider["changePlan"]>[0]): Promise<BillingProviderSubscription> {
    return this.unsupported("planChanges");
  }

  async cancelSubscription(_input: Parameters<BillingProvider["cancelSubscription"]>[0]): Promise<BillingProviderSubscription> {
    return this.unsupported("cancellation");
  }

  async createBillingPortal(_input: Parameters<BillingProvider["createBillingPortal"]>[0]): Promise<BillingProviderPortal> {
    return this.unsupported("portal");
  }

  async verifyWebhook(_input: Parameters<BillingProvider["verifyWebhook"]>[0]): Promise<BillingProviderWebhookEvent> {
    return this.unsupported("webhooks");
  }

  async recordPayment(_input: Parameters<BillingProvider["recordPayment"]>[0]): Promise<BillingProviderPayment> {
    return this.unsupported("payments");
  }

  async refundPayment(_input: Parameters<BillingProvider["refundPayment"]>[0]): Promise<BillingProviderRefund> {
    return this.unsupported("refunds");
  }
}
