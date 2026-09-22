import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDatabase, schema } from "@wa/db";
import { BillingLimitExceededError, type UsageAppendInput } from "./entitlements";
import { DrizzleBillingRepository } from "./drizzle-repository";

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl) {
  describe("DrizzleBillingRepository concurrent metering", () => {
    const { client, db } = createDatabase(databaseUrl);
    const repository = new DrizzleBillingRepository(db);
    const organizationId = randomUUID();
    const billingAccountId = randomUUID();
    const planId = randomUUID();
    const planVersionId = randomUUID();
    const subscriptionId = randomUUID();
    const periodStart = new Date("2026-09-01T00:00:00.000Z");
    const periodEnd = new Date("2026-10-01T00:00:00.000Z");

    function usage(idempotencyKey: string, limit: number | null): UsageAppendInput {
      return {
        organizationId,
        subscriptionId,
        entitlementKey: "monthly_campaign_recipients",
        quantity: 1,
        idempotencyKey,
        periodStart,
        periodEnd,
        occurredAt: new Date("2026-09-22T00:00:00.000Z"),
        metadata: {},
        limit,
      };
    }

    beforeAll(async () => {
      await db.insert(schema.organizations).values({
        id: organizationId,
        name: "Billing metering concurrency test",
        slug: `billing-metering-${organizationId}`,
      });
      await db.insert(schema.billingAccounts).values({
        id: billingAccountId,
        organizationId,
      });
      await db.insert(schema.billingPlans).values({
        id: planId,
        organizationId,
        code: `billing-metering-${organizationId}`,
        name: "Billing metering concurrency test",
        isCustom: true,
      });
      await db.insert(schema.billingPlanVersions).values({
        id: planVersionId,
        planId,
        version: 1,
        interval: "month",
        currency: "USD",
      });
      await db.insert(schema.billingSubscriptions).values({
        id: subscriptionId,
        billingAccountId,
        organizationId,
        planVersionId,
        status: "active",
        isManual: true,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      });
    });

    beforeEach(async () => {
      await db
        .delete(schema.billingUsageLedger)
        .where(eq(schema.billingUsageLedger.organizationId, organizationId));
      await db
        .delete(schema.billingPeriodUsage)
        .where(eq(schema.billingPeriodUsage.organizationId, organizationId));
    });

    afterAll(async () => {
      await db.delete(schema.organizations).where(eq(schema.organizations.id, organizationId));
      await client.end({ timeout: 5 });
    });

    test("records parallel unlimited usage without duplicate increments", async () => {
      const results = await Promise.all(
        Array.from({ length: 200 }, (_, index) =>
          repository.appendUsage(usage(`unlimited-${index}`, null)),
        ),
      );

      expect(results.every((result) => result.recorded)).toBe(true);
      expect(await repository.getUsage({
        organizationId,
        subscriptionId,
        entitlementKey: "monthly_campaign_recipients",
        periodStart,
        periodEnd,
      })).toBe(200);

      const duplicates = await Promise.all(
        Array.from({ length: 50 }, () =>
          repository.appendUsage(usage("duplicate-key", null)),
        ),
      );

      expect(duplicates.filter((result) => result.recorded)).toHaveLength(1);
      expect(await repository.getUsage({
        organizationId,
        subscriptionId,
        entitlementKey: "monthly_campaign_recipients",
        periodStart,
        periodEnd,
      })).toBe(201);
    });

    test("enforces a finite quota atomically under concurrency", async () => {
      const keys = Array.from({ length: 25 }, (_, index) => `limited-${index}`);
      const results = await Promise.allSettled(
        keys.map((key) => repository.appendUsage(usage(key, 10))),
      );

      const fulfilled = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter((result) => result.status === "rejected");

      expect(fulfilled).toHaveLength(10);
      expect(rejected).toHaveLength(15);
      for (const result of rejected) {
        if (result.status === "rejected") {
          expect(result.reason).toBeInstanceOf(BillingLimitExceededError);
        }
      }

      expect(await repository.getUsage({
        organizationId,
        subscriptionId,
        entitlementKey: "monthly_campaign_recipients",
        periodStart,
        periodEnd,
      })).toBe(10);

      const rejectedIndex = results.findIndex((result) => result.status === "rejected");
      expect(rejectedIndex).toBeGreaterThanOrEqual(0);
      const retryKey = keys[rejectedIndex]!;

      const retried = await repository.appendUsage(usage(retryKey, 11));
      expect(retried).toEqual({ recorded: true, total: 11 });

      const duplicate = await repository.appendUsage(usage(retryKey, 11));
      expect(duplicate).toEqual({ recorded: false, total: 11 });
    });
  });
}
