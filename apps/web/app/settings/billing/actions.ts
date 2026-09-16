"use server";

import { redirect } from "next/navigation";
import { requireAuthContext } from "@/lib/auth-context";
import {
  createBillingPortalUrl,
  requestOnlinePlanChange,
  scheduleOnlineSubscriptionCancellation,
  type OnlineBillingPlanCode,
} from "@/lib/billing-provider";
import { can } from "@/lib/workspace-access";

async function requireBillingManager() {
  const context = await requireAuthContext();
  if (!can(context.workspace.role, "billing.manage")) {
    throw new Error("You do not have permission to manage billing");
  }
  return context;
}

function planCodeFrom(formData: FormData): OnlineBillingPlanCode {
  const value = formData.get("planCode");
  if (value !== "growth" && value !== "scale") throw new Error("Invalid billing plan");
  return value;
}

export async function changeOnlinePlanAction(formData: FormData): Promise<never> {
  const { workspace, session } = await requireBillingManager();
  let result: Awaited<ReturnType<typeof requestOnlinePlanChange>>;
  try {
    result = await requestOnlinePlanChange({
      organizationId: workspace.organizationId,
      organizationName: workspace.organizationName,
      userEmail: session.user.email,
      planCode: planCodeFrom(formData),
    });
  } catch {
    redirect("/settings/billing?billing=provider-error");
  }
  redirect(result.kind === "checkout" ? result.url : "/settings/billing?billing=plan-change-requested");
}

export async function openBillingPortalAction(): Promise<never> {
  const { workspace } = await requireBillingManager();
  let url: string;
  try {
    url = await createBillingPortalUrl(workspace.organizationId);
  } catch {
    redirect("/settings/billing?billing=provider-error");
  }
  redirect(url);
}

export async function cancelOnlineSubscriptionAction(): Promise<never> {
  const { workspace } = await requireBillingManager();
  try {
    await scheduleOnlineSubscriptionCancellation(workspace.organizationId);
  } catch {
    redirect("/settings/billing?billing=provider-error");
  }
  redirect("/settings/billing?billing=cancellation-requested");
}
