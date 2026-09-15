import { schema } from "@wa/db";
import type { EntitlementKey } from "../entitlements";
import { auditBillingAction, billingAuditActions, type BillingDb, slugPart } from "./shared";

export function createPlanAdminService(db: BillingDb) {
  return {
    async createCustomPlan(input: {
      organizationId: string;
      name: string;
      code?: string;
      actorUserId?: string | null;
      entitlements: Partial<Record<EntitlementKey, number | null>>;
    }) {
      const code = input.code?.trim() || `${slugPart(input.name)}-${input.organizationId.slice(0, 8)}-${crypto.randomUUID().slice(0, 6)}`;
      const result = await db.transaction(async (tx) => {
        const plan = (
          await tx
            .insert(schema.billingPlans)
            .values({
              organizationId: input.organizationId,
              code,
              name: input.name,
              isCustom: true,
              isActive: true,
            })
            .returning()
        )[0];
        if (!plan) throw new Error("Could not create custom plan");

        const version = (
          await tx
            .insert(schema.billingPlanVersions)
            .values({ planId: plan.id, version: 1, interval: "custom", currency: "USD" })
            .returning()
        )[0];
        if (!version) throw new Error("Could not create custom plan version");

        const entries = Object.entries(input.entitlements) as Array<[EntitlementKey, number | null | undefined]>;
        const values = entries
          .filter((entry): entry is [EntitlementKey, number | null] => entry[1] !== undefined)
          .map(([key, limitValue]) => ({ planVersionId: version.id, key, limitValue }));
        if (values.length) await tx.insert(schema.billingPlanEntitlements).values(values);

        return { plan, version };
      });

      await auditBillingAction(db, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId ?? null,
        action: billingAuditActions.manualOverride,
        targetType: "plan",
        targetId: result.plan.id,
        metadata: { operation: "custom_plan_created", code: result.plan.code },
      });
      return result;
    },
  };
}
