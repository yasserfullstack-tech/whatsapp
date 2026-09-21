import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, mock, test } from "bun:test";
import { and, desc, eq } from "drizzle-orm";
import { createDatabase, schema } from "@wa/db";

/**
 * Integration coverage for `reserveStripeCheckoutAttempt` in
 * `@/lib/billing-provider` (issue #51 / PR-006 hardening).
 *
 * The function is module-private, so it is exercised through
 * `requestOnlinePlanChange` against a real Postgres database with the Stripe
 * HTTP surface stubbed out. The assertions are written so that removing the
 * attempt-reuse branch or the TTL expiry check makes the test fail.
 */

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for billing provider integration tests");

const database = createDatabase(databaseUrl);
const db = database.db;

// Mirror the substitution used by the other web integration tests so that a
// process-wide module mock never hides an export from a sibling test file.
mock.module("@/lib/server", () => ({
  db,
  databaseClient: database.client,
  getR2ServerConfig: () => ({ accountId: "test", accessKeyId: "test", secretAccessKey: "test", bucket: "test-bucket" }),
  contactImportQueue: { add: async () => undefined },
}));

const { requestOnlinePlanChange } = await import("@/lib/billing-provider");

type BillingDb = typeof db;

const originalFetch = globalThis.fetch;
const checkoutIdempotencyKeys: (string | null)[] = [];

function installCheckoutFetchStub() {
  globalThis.fetch = (async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.endsWith("/v1/checkout/sessions")) {
      const headers = new Headers(init?.headers);
      checkoutIdempotencyKeys.push(headers.get("idempotency-key"));
      const index = checkoutIdempotencyKeys.length;
      return new Response(JSON.stringify({
        id: `cs_${index}`,
        url: `https://checkout.stripe.test/${index}`,
        expires_at: 1_790_000_000,
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected Stripe request during test: ${url}`);
  }) as typeof globalThis.fetch;
}

async function configureGrowthPrice(db: BillingDb, price: string) {
  const row = (
    await db
      .select({
        id: schema.billingPlanVersions.id,
        providerPriceRef: schema.billingPlanVersions.providerPriceRef,
      })
      .from(schema.billingPlanVersions)
      .innerJoin(schema.billingPlans, eq(schema.billingPlans.id, schema.billingPlanVersions.planId))
      .where(and(eq(schema.billingPlans.code, "growth"), eq(schema.billingPlans.isActive, true)))
      .orderBy(desc(schema.billingPlanVersions.version))
      .limit(1)
  )[0];
  if (!row) throw new Error("Seeded growth billing plan is missing");
  await db
    .update(schema.billingPlanVersions)
    .set({ providerPriceRef: price })
    .where(eq(schema.billingPlanVersions.id, row.id));
  return { id: row.id, original: row.providerPriceRef };
}

async function persistedAttempt(db: BillingDb, organizationId: string) {
  const account = (
    await db.select().from(schema.billingAccounts).where(eq(schema.billingAccounts.organizationId, organizationId)).limit(1)
  )[0];
  const metadata = (account?.metadata ?? {}) as Record<string, unknown>;
  return metadata.stripeCheckoutAttempt as { key: string; planCode: string; expiresAt: string } | undefined;
}

afterAll(async () => {
  globalThis.fetch = originalFetch;
  mock.restore();
  await database.client.end();
});

describe("Stripe Checkout attempt reservation", () => {
  test("reuses an in-flight attempt for the same plan, rejects another plan, and replaces an expired attempt", async () => {
    installCheckoutFetchStub();
    process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? "sk_test_guard9";
    process.env.APP_URL = process.env.APP_URL ?? "https://app.guard.test";

    const suffix = randomUUID();
    const growthPrice = `price_growth_${suffix}`;
    const scalePrice = `price_scale_${suffix}`;
    process.env.STRIPE_PRICE_GROWTH = growthPrice;
    process.env.STRIPE_PRICE_SCALE = scalePrice;

    const growth = await configureGrowthPrice(db, growthPrice);
    let organizationId: string | null = null;
    try {
      const [organization] = await db
        .insert(schema.organizations)
        .values({ name: `Checkout attempt ${suffix}`, slug: `checkout-attempt-${suffix}` })
        .returning();
      if (!organization) throw new Error("Failed to create organization fixture");
      organizationId = organization.id;

      const customerId = `cus_${suffix}`;
      await db.insert(schema.billingAccounts).values({
        organizationId: organization.id,
        providerKey: "stripe",
        providerCustomerId: customerId,
      });

      // First reservation creates a fresh attempt.
      const first = await requestOnlinePlanChange({ organizationId: organization.id, planCode: "growth" });
      expect(first.kind).toBe("checkout");
      const firstKey = checkoutIdempotencyKeys[0];
      if (!firstKey) throw new Error("Expected the first Checkout to reserve an idempotency key");

      const firstAttempt = await persistedAttempt(db, organization.id);
      expect(firstAttempt?.key).toBe(firstKey);
      expect(firstAttempt?.planCode).toBe("growth");
      const firstExpiresAt = new Date(firstAttempt!.expiresAt).getTime();
      expect(firstExpiresAt - Date.now()).toBeGreaterThan(44 * 60_000);
      expect(firstExpiresAt - Date.now()).toBeLessThanOrEqual(45 * 60_000);

      // A second Checkout for the same plan reuses the in-flight attempt.
      const second = await requestOnlinePlanChange({ organizationId: organization.id, planCode: "growth" });
      expect(second.kind).toBe("checkout");
      expect(checkoutIdempotencyKeys).toHaveLength(2);
      expect(checkoutIdempotencyKeys[1]).toBe(firstKey);
      const secondAttempt = await persistedAttempt(db, organization.id);
      expect(secondAttempt?.key).toBe(firstKey);

      // A Checkout for a different plan while one is in flight is rejected.
      await expect(
        requestOnlinePlanChange({ organizationId: organization.id, planCode: "scale" }),
      ).rejects.toThrow("A Stripe Checkout session is already in progress for another plan");
      expect(checkoutIdempotencyKeys).toHaveLength(2);
      expect((await persistedAttempt(db, organization.id))?.key).toBe(firstKey);

      // Once the attempt has expired a new one is reserved.
      await db
        .update(schema.billingAccounts)
        .set({
          metadata: {
            stripeCheckoutAttempt: {
              key: firstKey,
              planCode: "growth",
              expiresAt: new Date(Date.now() - 60_000).toISOString(),
            },
          },
        })
        .where(eq(schema.billingAccounts.organizationId, organization.id));

      const third = await requestOnlinePlanChange({ organizationId: organization.id, planCode: "growth" });
      expect(third.kind).toBe("checkout");
      expect(checkoutIdempotencyKeys).toHaveLength(3);
      const thirdKey = checkoutIdempotencyKeys[2];
      if (!thirdKey) throw new Error("Expected the expired attempt to be replaced with a new key");
      expect(thirdKey).not.toBe(firstKey);
      const thirdAttempt = await persistedAttempt(db, organization.id);
      expect(thirdAttempt?.key).toBe(thirdKey);
      const thirdExpiresAt = new Date(thirdAttempt!.expiresAt).getTime();
      expect(thirdExpiresAt - Date.now()).toBeGreaterThan(44 * 60_000);
      expect(thirdExpiresAt - Date.now()).toBeLessThanOrEqual(45 * 60_000);
    } finally {
      if (organizationId) {
        await db.delete(schema.organizations).where(eq(schema.organizations.id, organizationId));
      }
      await db
        .update(schema.billingPlanVersions)
        .set({ providerPriceRef: growth.original })
        .where(eq(schema.billingPlanVersions.id, growth.id));
      checkoutIdempotencyKeys.length = 0;
    }
  });
});
