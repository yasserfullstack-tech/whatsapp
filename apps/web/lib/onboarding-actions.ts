"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { schema } from "@wa/db";
import { requireAuthContext } from "@/lib/auth-context";
import { db } from "@/lib/server";
import { requireWorkspaceAction } from "@/lib/workspace-access";

const optionalSteps = new Set(["workspace", "test"]);

async function requireOnboardingManager() {
  const context = await requireAuthContext();
  requireWorkspaceAction(context.workspace.role, "workspace.update");
  return context;
}

async function getState(organizationId: string) {
  return db.select().from(schema.organizationOnboarding)
    .where(eq(schema.organizationOnboarding.organizationId, organizationId))
    .limit(1)
    .then((rows) => rows[0]);
}

async function revalidateOnboarding() {
  revalidatePath("/onboarding");
  revalidatePath("/dashboard");
  revalidatePath("/contacts");
  revalidatePath("/audiences");
  revalidatePath("/templates");
  revalidatePath("/campaigns");
}

export async function confirmOnboardingConsentAction(formData: FormData) {
  const { workspace } = await requireOnboardingManager();
  if (formData.get("consent") !== "confirmed") redirect("/onboarding?error=consent");

  const now = new Date();
  await db.insert(schema.organizationOnboarding)
    .values({ organizationId: workspace.organizationId, consentConfirmedAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.organizationOnboarding.organizationId,
      set: { consentConfirmedAt: now, updatedAt: now },
    });

  await revalidateOnboarding();
  redirect("/onboarding#consent");
}

export async function skipOnboardingStepAction(formData: FormData) {
  const { workspace } = await requireOnboardingManager();
  const step = String(formData.get("step") ?? "");
  if (!optionalSteps.has(step)) redirect("/onboarding");

  const current = await getState(workspace.organizationId);
  const skippedSteps = [...new Set([...(current?.skippedSteps ?? []), step])];
  const now = new Date();
  await db.insert(schema.organizationOnboarding)
    .values({ organizationId: workspace.organizationId, skippedSteps, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.organizationOnboarding.organizationId,
      set: { skippedSteps, updatedAt: now },
    });

  await revalidateOnboarding();
  redirect("/onboarding");
}

export async function skipOnboardingAction() {
  const { workspace } = await requireOnboardingManager();
  const current = await getState(workspace.organizationId);
  if (!current?.consentConfirmedAt) redirect("/onboarding?error=consent");

  const now = new Date();
  await db.insert(schema.organizationOnboarding)
    .values({ organizationId: workspace.organizationId, skippedAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.organizationOnboarding.organizationId,
      set: { skippedAt: now, completedAt: null, updatedAt: now },
    });

  await revalidateOnboarding();
  redirect("/dashboard");
}

export async function resumeOnboardingAction() {
  const { workspace } = await requireOnboardingManager();
  const now = new Date();
  await db.insert(schema.organizationOnboarding)
    .values({ organizationId: workspace.organizationId, skippedAt: null, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.organizationOnboarding.organizationId,
      set: { skippedAt: null, updatedAt: now },
    });

  await revalidateOnboarding();
  redirect("/onboarding");
}

export async function completeOnboardingAction() {
  const { workspace } = await requireOnboardingManager();
  const current = await getState(workspace.organizationId);
  if (!current?.consentConfirmedAt) redirect("/onboarding?error=consent");

  const now = new Date();
  await db.insert(schema.organizationOnboarding)
    .values({ organizationId: workspace.organizationId, completedAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.organizationOnboarding.organizationId,
      set: { completedAt: now, skippedAt: null, updatedAt: now },
    });

  await revalidateOnboarding();
  redirect("/dashboard");
}
