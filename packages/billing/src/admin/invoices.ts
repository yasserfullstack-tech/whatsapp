import { and, eq } from "drizzle-orm";
import { schema } from "@wa/db";
import { auditBillingAction, billingAccountFor, billingAuditActions, type BillingDb } from "./shared";

export function createInvoiceAdminService(db: BillingDb) {
  return {
    async createManualInvoice(input: {
      organizationId: string;
      subscriptionId?: string | null;
      invoiceNumber?: string | null;
      currency: string;
      amountMinor: number;
      dueAt?: Date | null;
      actorUserId?: string | null;
      metadata?: Record<string, unknown>;
    }) {
      const account = await billingAccountFor(db, input.organizationId);
      const invoice = (
        await db
          .insert(schema.billingInvoices)
          .values({
            organizationId: input.organizationId,
            billingAccountId: account.id,
            subscriptionId: input.subscriptionId ?? null,
            invoiceNumber: input.invoiceNumber ?? null,
            status: "open",
            currency: input.currency,
            subtotalMinor: input.amountMinor,
            totalMinor: input.amountMinor,
            amountDueMinor: input.amountMinor,
            dueAt: input.dueAt ?? null,
            metadata: input.metadata ?? {},
          })
          .returning()
      )[0];
      if (!invoice) throw new Error("Could not create manual invoice");

      await auditBillingAction(db, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId ?? null,
        action: billingAuditActions.manualOverride,
        targetType: "invoice",
        targetId: invoice.id,
        metadata: { operation: "manual_invoice" },
      });
      return invoice;
    },

    async recordManualPayment(input: {
      organizationId: string;
      invoiceId: string;
      amountMinor: number;
      currency: string;
      paidAt?: Date;
      actorUserId?: string | null;
      metadata?: Record<string, unknown>;
    }) {
      const invoice = (
        await db
          .select()
          .from(schema.billingInvoices)
          .where(and(eq(schema.billingInvoices.id, input.invoiceId), eq(schema.billingInvoices.organizationId, input.organizationId)))
          .limit(1)
      )[0];
      if (!invoice) throw new Error("Invoice not found");

      const paidAt = input.paidAt ?? new Date();
      const payment = (
        await db
          .insert(schema.billingPayments)
          .values({
            organizationId: input.organizationId,
            invoiceId: input.invoiceId,
            status: "succeeded",
            currency: input.currency,
            amountMinor: input.amountMinor,
            paidAt,
            metadata: input.metadata ?? {},
          })
          .returning()
      )[0];
      if (!payment) throw new Error("Could not record manual payment");

      const amountPaidMinor = Math.min(invoice.totalMinor, invoice.amountPaidMinor + input.amountMinor);
      await db
        .update(schema.billingInvoices)
        .set({
          amountPaidMinor,
          amountDueMinor: Math.max(0, invoice.totalMinor - amountPaidMinor),
          status: amountPaidMinor >= invoice.totalMinor ? "paid" : invoice.status,
          paidAt: amountPaidMinor >= invoice.totalMinor ? paidAt : invoice.paidAt,
          updatedAt: new Date(),
        })
        .where(and(eq(schema.billingInvoices.id, input.invoiceId), eq(schema.billingInvoices.organizationId, input.organizationId)));

      await auditBillingAction(db, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId ?? null,
        action: billingAuditActions.manualOverride,
        targetType: "payment",
        targetId: payment.id,
        metadata: { operation: "manual_payment", invoiceId: input.invoiceId },
      });
      return payment;
    },
  };
}
