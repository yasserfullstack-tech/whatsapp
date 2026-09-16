import {
  BillingEntitlementError,
  BillingLimitExceededError,
  DrizzleBillingRepository,
  EntitlementService,
} from "@wa/billing";
import { db } from "./server";

export const entitlements = new EntitlementService(new DrizzleBillingRepository(db));

export function entitlementErrorPayload(error: unknown) {
  if (error instanceof BillingLimitExceededError) {
    return {
      error: "entitlement_limit_exceeded" as const,
      entitlementKey: error.key,
      limit: error.limit,
      attemptedTotal: error.attemptedTotal,
    };
  }

  if (error instanceof BillingEntitlementError) {
    return {
      error: "entitlement_unavailable" as const,
      entitlementKey: error.key,
      reason: error.reason,
    };
  }

  return null;
}
