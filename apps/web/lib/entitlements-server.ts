import { DrizzleBillingRepository, EntitlementService } from "@wa/billing";
import { db } from "./server";

export const entitlements = new EntitlementService(new DrizzleBillingRepository(db));
