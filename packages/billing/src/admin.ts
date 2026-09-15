import { createInvoiceAdminService } from "./admin/invoices";
import { createPlanAdminService } from "./admin/plans";
import { createSubscriptionAdminService } from "./admin/subscriptions";
import type { BillingDb } from "./admin/shared";

export { ensureDefaultBilling } from "./admin/bootstrap";
export { billingAuditActions } from "./admin/shared";

export function createBillingAdminService(db: BillingDb) {
  return {
    ...createPlanAdminService(db),
    ...createSubscriptionAdminService(db),
    ...createInvoiceAdminService(db),
  };
}
