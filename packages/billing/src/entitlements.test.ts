import { describe, expect, test } from "bun:test";
import {
  BillingEntitlementError,
  BillingLimitExceededError,
  EntitlementService,
  type BillingEntitlementSnapshot,
  type BillingRepository,
  type BillingSubscriptionSnapshot,
  type EntitlementKey,
  type UsageAppendInput,
  type UsageAppendResult,
} from "./entitlements";

function period(start: string, end: string) {
  return { currentPeriodStart: new Date(start), currentPeriodEnd: new Date(end) };
}

function subscription(
  organizationId: string,
  overrides: Partial<BillingSubscriptionSnapshot> = {},
): BillingSubscriptionSnapshot {
  return {
    organizationId,
    subscriptionId: `${organizationId}-sub`,
    planVersionId: "plan-v1",
    planCode: "starter",
    planName: "Starter",
    status: "active",
    isManual: false,
    ...period("2026-09-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"),
    trialEndsAt: null,
    graceEndsAt: null,
    ...overrides,
  };
}

class FakeBillingRepository implements BillingRepository {
  readonly subscriptions = new Map<string, BillingSubscriptionSnapshot>();
  readonly entitlements = new Map<string, BillingEntitlementSnapshot>();
  readonly usage = new Map<string, number>();
  readonly idempotency = new Set<string>();

  entitlement(planVersionId: string, key: EntitlementKey, limit: number | null, enabled = true) {
    this.entitlements.set(`${planVersionId}:${key}`, { enabled, limit });
  }

  usageKey(input: {
    organizationId: string;
    subscriptionId: string;
    entitlementKey: EntitlementKey;
    periodStart: Date;
    periodEnd: Date;
  }) {
    return [
      input.organizationId,
      input.subscriptionId,
      input.entitlementKey,
      input.periodStart.toISOString(),
      input.periodEnd.toISOString(),
    ].join(":");
  }

  async getUsageContext(organizationId: string, key: EntitlementKey, _at: Date) {
    const subscription = this.subscriptions.get(organizationId) ?? null;
    return {
      subscription,
      entitlement: subscription
        ? this.entitlements.get(`${subscription.planVersionId}:${key}`) ?? null
        : null,
    };
  }

  async getCurrentSubscription(organizationId: string, _at: Date) {
    return this.subscriptions.get(organizationId) ?? null;
  }

  async getEntitlement(planVersionId: string, key: EntitlementKey) {
    return this.entitlements.get(`${planVersionId}:${key}`) ?? null;
  }

  async getUsage(input: Parameters<BillingRepository["getUsage"]>[0]) {
    return this.usage.get(this.usageKey(input)) ?? 0;
  }

  async appendUsage(input: UsageAppendInput): Promise<UsageAppendResult> {
    const currentSubscription = this.subscriptions.get(input.organizationId);
    if (!currentSubscription || currentSubscription.subscriptionId !== input.subscriptionId) {
      throw new Error("tenant/subscription mismatch");
    }

    const idempotencyKey = `${input.organizationId}:${input.idempotencyKey}`;
    const key = this.usageKey(input);
    const current = this.usage.get(key) ?? 0;
    if (this.idempotency.has(idempotencyKey)) return { recorded: false, total: current };

    const attemptedTotal = current + input.quantity;
    if (input.limit !== null && attemptedTotal > input.limit) {
      throw new BillingLimitExceededError(input.entitlementKey, input.limit, attemptedTotal);
    }
    this.idempotency.add(idempotencyKey);
    this.usage.set(key, attemptedTotal);
    return { recorded: true, total: attemptedTotal };
  }
}

describe("EntitlementService", () => {
  test("enforces capacity and operation plan limits without hard-coded product checks", async () => {
    const repository = new FakeBillingRepository();
    repository.subscriptions.set("org-a", subscription("org-a"));
    repository.entitlement("plan-v1", "max_contacts", 10);
    repository.entitlement("plan-v1", "max_import_size", 5000);
    const service = new EntitlementService(repository);

    expect((await service.checkUsage("org-a", "max_contacts", { currentUsage: 9, requested: 1 })).allowed).toBe(true);
    const denied = await service.checkUsage("org-a", "max_contacts", { currentUsage: 9, requested: 2 });
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toBe("limit_exceeded");
    expect((await service.checkUsage("org-a", "max_import_size", { requested: 5001 })).allowed).toBe(false);
  });

  test("throws structured errors from server-side assertions", async () => {
    const repository = new FakeBillingRepository();
    repository.subscriptions.set("org-a", subscription("org-a"));
    repository.entitlement("plan-v1", "max_members", 3);
    const service = new EntitlementService(repository);

    await expect(service.assertUsage("org-a", "max_members", { currentUsage: 2, requested: 1 })).resolves.toMatchObject({
      allowed: true,
      limit: 3,
      used: 2,
      remaining: 1,
    });

    try {
      await service.assertUsage("org-a", "max_members", { currentUsage: 3, requested: 1 });
      throw new Error("expected max_members enforcement to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(BillingLimitExceededError);
      expect(error).toMatchObject({ key: "max_members", limit: 3, attemptedTotal: 4 });
    }

    repository.subscriptions.set("org-a", subscription("org-a", { status: "suspended" }));
    try {
      await service.assertUsage("org-a", "max_members", { currentUsage: 1, requested: 1 });
      throw new Error("expected suspended subscription to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(BillingEntitlementError);
      expect(error).toMatchObject({ key: "max_members", reason: "subscription_inactive" });
    }
  });

  test("allows a live trial and stops it after the trial boundary", async () => {
    const repository = new FakeBillingRepository();
    repository.subscriptions.set("org-a", subscription("org-a", {
      status: "trialing",
      trialEndsAt: new Date("2026-09-15T00:00:00.000Z"),
    }));
    repository.entitlement("plan-v1", "max_members", 3);
    const service = new EntitlementService(repository);

    expect(await service.canUseFeature("org-a", "max_members", new Date("2026-09-14T00:00:00.000Z"))).toBe(true);
    expect(await service.canUseFeature("org-a", "max_members", new Date("2026-09-16T00:00:00.000Z"))).toBe(false);
  });

  test("distinguishes past-due from an explicit grace period", async () => {
    const repository = new FakeBillingRepository();
    repository.entitlement("plan-v1", "max_phone_numbers", 2);
    const service = new EntitlementService(repository);

    repository.subscriptions.set("org-a", subscription("org-a", { status: "past_due" }));
    expect(await service.canUseFeature("org-a", "max_phone_numbers")).toBe(false);

    repository.subscriptions.set("org-a", subscription("org-a", {
      status: "grace_period",
      graceEndsAt: new Date("2026-09-20T00:00:00.000Z"),
    }));
    expect(await service.canUseFeature("org-a", "max_phone_numbers", new Date("2026-09-19T00:00:00.000Z"))).toBe(true);
    expect(await service.canUseFeature("org-a", "max_phone_numbers", new Date("2026-09-21T00:00:00.000Z"))).toBe(false);
  });

  test("counts metered usage idempotently and enforces the period limit", async () => {
    const repository = new FakeBillingRepository();
    repository.subscriptions.set("org-a", subscription("org-a"));
    repository.entitlement("plan-v1", "monthly_campaign_recipients", 100);
    const service = new EntitlementService(repository);

    const first = await service.recordUsage({
      organizationId: "org-a",
      key: "monthly_campaign_recipients",
      quantity: 40,
      idempotencyKey: "campaign-1",
    });
    expect(first.recorded).toBe(true);
    expect(first.used).toBe(40);

    const duplicate = await service.recordUsage({
      organizationId: "org-a",
      key: "monthly_campaign_recipients",
      quantity: 40,
      idempotencyKey: "campaign-1",
    });
    expect(duplicate.recorded).toBe(false);
    expect(duplicate.used).toBe(40);

    await service.recordUsage({
      organizationId: "org-a",
      key: "monthly_campaign_recipients",
      quantity: 60,
      idempotencyKey: "campaign-2",
    });

    const duplicateAtQuota = await service.recordUsage({
      organizationId: "org-a",
      key: "monthly_campaign_recipients",
      quantity: 60,
      idempotencyKey: "campaign-2",
    });
    expect(duplicateAtQuota.recorded).toBe(false);
    expect(duplicateAtQuota.used).toBe(100);

    await expect(service.recordUsage({
      organizationId: "org-a",
      key: "monthly_campaign_recipients",
      quantity: 1,
      idempotencyKey: "campaign-3",
    })).rejects.toBeInstanceOf(BillingLimitExceededError);
  });

  test("rolls metered usage with the subscription billing period", async () => {
    const repository = new FakeBillingRepository();
    repository.entitlement("plan-v1", "monthly_campaign_recipients", 100);
    repository.subscriptions.set("org-a", subscription("org-a"));
    const service = new EntitlementService(repository);

    await service.recordUsage({
      organizationId: "org-a",
      key: "monthly_campaign_recipients",
      quantity: 80,
      idempotencyKey: "sep-campaign",
    });

    repository.subscriptions.set("org-a", subscription("org-a", {
      ...period("2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z"),
    }));
    const october = await service.recordUsage({
      organizationId: "org-a",
      key: "monthly_campaign_recipients",
      quantity: 30,
      idempotencyKey: "oct-campaign",
    });
    expect(october.used).toBe(30);
    expect(october.remaining).toBe(70);
  });

  test("keeps usage isolated by organization even on the same plan", async () => {
    const repository = new FakeBillingRepository();
    repository.subscriptions.set("org-a", subscription("org-a"));
    repository.subscriptions.set("org-b", subscription("org-b"));
    repository.entitlement("plan-v1", "monthly_campaign_recipients", 100);
    const service = new EntitlementService(repository);

    await service.recordUsage({
      organizationId: "org-a",
      key: "monthly_campaign_recipients",
      quantity: 95,
      idempotencyKey: "campaign-a",
    });
    const orgB = await service.checkUsage("org-b", "monthly_campaign_recipients", { requested: 100 });
    expect(orgB.allowed).toBe(true);
    expect(orgB.used).toBe(0);
  });

  test("uses live plan versions for immediate upgrades and non-destructive downgrades", async () => {
    const repository = new FakeBillingRepository();
    repository.entitlement("starter-v1", "max_contacts", 10);
    repository.entitlement("growth-v1", "max_contacts", 100);
    repository.subscriptions.set("org-a", subscription("org-a", {
      planVersionId: "starter-v1",
      planCode: "starter",
      planName: "Starter",
    }));
    const service = new EntitlementService(repository);

    expect((await service.checkUsage("org-a", "max_contacts", { currentUsage: 10, requested: 1 })).allowed).toBe(false);

    repository.subscriptions.set("org-a", subscription("org-a", {
      planVersionId: "growth-v1",
      planCode: "growth",
      planName: "Growth",
    }));
    expect((await service.checkUsage("org-a", "max_contacts", { currentUsage: 10, requested: 1 })).allowed).toBe(true);

    repository.subscriptions.set("org-a", subscription("org-a", {
      planVersionId: "starter-v1",
      planCode: "starter",
      planName: "Starter",
    }));
    const downgraded = await service.checkUsage("org-a", "max_contacts", { currentUsage: 12, requested: 0 });
    expect(downgraded.allowed).toBe(false);
    expect(downgraded.used).toBe(12);
    expect(downgraded.limit).toBe(10);
  });

  test("manual subscriptions and custom plans use the same entitlement path", async () => {
    const repository = new FakeBillingRepository();
    repository.subscriptions.set("enterprise", subscription("enterprise", {
      planVersionId: "custom-v1",
      planCode: "custom-enterprise",
      planName: "Custom Enterprise",
      isManual: true,
    }));
    repository.entitlement("custom-v1", "max_contacts", 750_000);
    const service = new EntitlementService(repository);

    expect(await service.getLimit("enterprise", "max_contacts")).toBe(750_000);
    expect((await service.checkUsage("enterprise", "max_contacts", { currentUsage: 749_999, requested: 1 })).allowed).toBe(true);
  });
});
