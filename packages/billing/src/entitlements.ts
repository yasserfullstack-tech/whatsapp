export const entitlementDefinitions = {
  max_contacts: { mode: "capacity" },
  max_members: { mode: "capacity" },
  max_phone_numbers: { mode: "capacity" },
  monthly_campaign_recipients: { mode: "metered" },
  max_import_size: { mode: "configuration" },
  analytics_retention_days: { mode: "configuration" },
  audit_retention_days: { mode: "configuration" },
} as const;

export type EntitlementKey = keyof typeof entitlementDefinitions;
export type EntitlementMode = (typeof entitlementDefinitions)[EntitlementKey]["mode"];
export type BillingSubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "grace_period"
  | "suspended"
  | "cancelled";

export type BillingSubscriptionSnapshot = {
  organizationId: string;
  subscriptionId: string;
  planVersionId: string;
  planCode: string;
  planName: string;
  status: BillingSubscriptionStatus;
  isManual: boolean;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  trialEndsAt: Date | null;
  graceEndsAt: Date | null;
};

export type BillingEntitlementSnapshot = {
  enabled: boolean;
  limit: number | null;
  includeTotal?: boolean;
};

export type UsageAppendInput = {
  organizationId: string;
  subscriptionId: string;
  entitlementKey: EntitlementKey;
  quantity: number;
  idempotencyKey: string;
  periodStart: Date;
  periodEnd: Date;
  occurredAt: Date;
  metadata: Record<string, unknown>;
  limit: number | null;
};

export type UsageAppendResult = {
  recorded: boolean;
  total: number;
};

export interface BillingRepository {
  getCurrentSubscription(organizationId: string, at: Date): Promise<BillingSubscriptionSnapshot | null>;
  getEntitlement(planVersionId: string, key: EntitlementKey): Promise<BillingEntitlementSnapshot | null>;
  getUsage(input: {
    organizationId: string;
    subscriptionId: string;
    entitlementKey: EntitlementKey;
    periodStart: Date;
    periodEnd: Date;
  }): Promise<number>;
  appendUsage(input: UsageAppendInput): Promise<UsageAppendResult>;
}

export type UsageCheckReason =
  | "ok"
  | "no_subscription"
  | "subscription_inactive"
  | "entitlement_missing"
  | "entitlement_disabled"
  | "limit_exceeded";

export type UsageCheck = {
  allowed: boolean;
  reason: UsageCheckReason;
  status: BillingSubscriptionStatus | null;
  planCode: string | null;
  mode: EntitlementMode;
  limit: number | null;
  used: number;
  requested: number;
  remaining: number | null;
  periodStart: Date | null;
  periodEnd: Date | null;
};

export class BillingEntitlementError extends Error {
  constructor(
    readonly reason: UsageCheckReason,
    readonly key: EntitlementKey,
    message = `Billing entitlement ${key} denied: ${reason}`,
  ) {
    super(message);
    this.name = "BillingEntitlementError";
  }
}

export class BillingLimitExceededError extends Error {
  constructor(readonly key: EntitlementKey, readonly limit: number, readonly attemptedTotal: number) {
    super(`Billing entitlement ${key} would exceed limit ${limit} with total ${attemptedTotal}`);
    this.name = "BillingLimitExceededError";
  }
}

function isSubscriptionUsable(subscription: BillingSubscriptionSnapshot, at: Date): boolean {
  if (subscription.status === "active") return true;
  if (subscription.status === "trialing") {
    return subscription.trialEndsAt ? at <= subscription.trialEndsAt : true;
  }
  if (subscription.status === "grace_period") {
    return subscription.graceEndsAt ? at <= subscription.graceEndsAt : true;
  }
  return false;
}

function remaining(limit: number | null, used: number): number | null {
  return limit === null ? null : Math.max(0, limit - used);
}

export class EntitlementService {
  constructor(private readonly repository: BillingRepository) {}

  async canUseFeature(organizationId: string, key: EntitlementKey, at = new Date()): Promise<boolean> {
    return (await this.checkUsage(organizationId, key, { at })).allowed;
  }

  async getLimit(organizationId: string, key: EntitlementKey, at = new Date()): Promise<number | null | undefined> {
    const subscription = await this.repository.getCurrentSubscription(organizationId, at);
    if (!subscription || !isSubscriptionUsable(subscription, at)) return undefined;
    const entitlement = await this.repository.getEntitlement(subscription.planVersionId, key);
    if (!entitlement?.enabled) return undefined;
    return entitlement.limit;
  }

  async checkUsage(
    organizationId: string,
    key: EntitlementKey,
    options: { requested?: number; currentUsage?: number; at?: Date } = {},
  ): Promise<UsageCheck> {
    const at = options.at ?? new Date();
    const requested = options.requested ?? 0;
    if (!Number.isFinite(requested) || requested < 0) throw new Error("requested usage must be a non-negative number");

    const mode = entitlementDefinitions[key].mode;
    const subscription = await this.repository.getCurrentSubscription(organizationId, at);
    if (!subscription) {
      return {
        allowed: false,
        reason: "no_subscription",
        status: null,
        planCode: null,
        mode,
        limit: null,
        used: options.currentUsage ?? 0,
        requested,
        remaining: 0,
        periodStart: null,
        periodEnd: null,
      };
    }

    if (!isSubscriptionUsable(subscription, at)) {
      return {
        allowed: false,
        reason: "subscription_inactive",
        status: subscription.status,
        planCode: subscription.planCode,
        mode,
        limit: null,
        used: options.currentUsage ?? 0,
        requested,
        remaining: 0,
        periodStart: subscription.currentPeriodStart,
        periodEnd: subscription.currentPeriodEnd,
      };
    }

    const entitlement = await this.repository.getEntitlement(subscription.planVersionId, key);
    if (!entitlement) {
      return {
        allowed: false,
        reason: "entitlement_missing",
        status: subscription.status,
        planCode: subscription.planCode,
        mode,
        limit: null,
        used: options.currentUsage ?? 0,
        requested,
        remaining: 0,
        periodStart: subscription.currentPeriodStart,
        periodEnd: subscription.currentPeriodEnd,
      };
    }
    if (!entitlement.enabled) {
      return {
        allowed: false,
        reason: "entitlement_disabled",
        status: subscription.status,
        planCode: subscription.planCode,
        mode,
        limit: entitlement.limit,
        used: options.currentUsage ?? 0,
        requested,
        remaining: 0,
        periodStart: subscription.currentPeriodStart,
        periodEnd: subscription.currentPeriodEnd,
      };
    }

    const used = options.currentUsage ?? (mode === "metered"
      ? await this.repository.getUsage({
          organizationId,
          subscriptionId: subscription.subscriptionId,
          entitlementKey: key,
          periodStart: subscription.currentPeriodStart,
          periodEnd: subscription.currentPeriodEnd,
        })
      : 0);
    const attempted = used + requested;
    const allowed = entitlement.limit === null || attempted <= entitlement.limit;

    return {
      allowed,
      reason: allowed ? "ok" : "limit_exceeded",
      status: subscription.status,
      planCode: subscription.planCode,
      mode,
      limit: entitlement.limit,
      used,
      requested,
      remaining: remaining(entitlement.limit, used),
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
    };
  }

  async assertUsage(
    organizationId: string,
    key: EntitlementKey,
    options: { requested?: number; currentUsage?: number; at?: Date } = {},
  ): Promise<UsageCheck> {
    const check = await this.checkUsage(organizationId, key, options);
    if (check.allowed) return check;

    if (check.reason === "limit_exceeded" && check.limit !== null) {
      throw new BillingLimitExceededError(key, check.limit, check.used + check.requested);
    }

    throw new BillingEntitlementError(check.reason, key);
  }

  async recordUsage(input: {
    organizationId: string;
    key: EntitlementKey;
    quantity: number;
    idempotencyKey: string;
    occurredAt?: Date;
    metadata?: Record<string, unknown>;
    includeTotal?: boolean;
  }): Promise<UsageCheck & { recorded: boolean }> {
    if (entitlementDefinitions[input.key].mode !== "metered") {
      throw new BillingEntitlementError("entitlement_missing", input.key, `${input.key} is not a metered entitlement`);
    }
    if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
      throw new Error("recordUsage quantity must be a positive integer");
    }
    if (!input.idempotencyKey.trim()) throw new Error("recordUsage idempotencyKey is required");

    const at = input.occurredAt ?? new Date();
    // Metering validates the live subscription on every call. The numeric limit
    // remains authoritative inside appendUsage so concurrent sends cannot
    // overshoot a finite quota and idempotent retries remain safe.
    const subscription = await this.repository.getCurrentSubscription(input.organizationId, at);
    if (!subscription) throw new BillingEntitlementError("no_subscription", input.key);
    if (!isSubscriptionUsable(subscription, at)) {
      throw new BillingEntitlementError("subscription_inactive", input.key);
    }

    const entitlement = await this.repository.getEntitlement(subscription.planVersionId, input.key);
    if (!entitlement) throw new BillingEntitlementError("entitlement_missing", input.key);
    if (!entitlement.enabled) throw new BillingEntitlementError("entitlement_disabled", input.key);

    const result = await this.repository.appendUsage({
      organizationId: input.organizationId,
      subscriptionId: subscription.subscriptionId,
      entitlementKey: input.key,
      quantity: input.quantity,
      idempotencyKey: input.idempotencyKey,
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
      occurredAt: at,
      metadata: input.metadata ?? {},
      limit: entitlement.limit,
      includeTotal: input.includeTotal,
    });

    return {
      allowed: entitlement.limit === null || result.total <= entitlement.limit,
      reason: entitlement.limit === null || result.total <= entitlement.limit ? "ok" : "limit_exceeded",
      status: subscription.status,
      planCode: subscription.planCode,
      mode: entitlementDefinitions[input.key].mode,
      limit: entitlement.limit,
      used: result.total,
      requested: 0,
      remaining: remaining(entitlement.limit, result.total),
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
      recorded: result.recorded,
    };
  }
}
