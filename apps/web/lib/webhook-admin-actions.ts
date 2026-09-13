"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { schema } from "@wa/db";
import { requirePlatformAdmin } from "./platform-admin";
import { db, webhookQueue } from "./server";

function requiredText(formData: FormData, key: string): string {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1_500) : String(error).slice(0, 1_500);
}

export async function retryWebhookEventAction(formData: FormData) {
  const actor = await requirePlatformAdmin();
  const eventId = requiredText(formData, "eventId");
  const [event] = await db
    .select({
      id: schema.webhookEvents.id,
      organizationId: schema.webhookEvents.organizationId,
      processedAt: schema.webhookEvents.processedAt,
      processingStatus: schema.webhookEvents.processingStatus,
      processingAttempts: schema.webhookEvents.processingAttempts,
    })
    .from(schema.webhookEvents)
    .where(eq(schema.webhookEvents.id, eventId))
    .limit(1);

  if (!event) throw new Error("Webhook event not found");
  if (event.processedAt) throw new Error("Processed webhook events do not need replay");
  if (event.processingStatus === "processing") {
    throw new Error("Webhook event is currently processing");
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.webhookEvents)
      .set({
        processingStatus: "retry",
        processingStartedAt: null,
        nextRetryAt: now,
        deadLetteredAt: null,
      })
      .where(eq(schema.webhookEvents.id, event.id));

    await tx.insert(schema.platformAuditEvents).values({
      actorAuthUserId: actor.authUserId,
      organizationId: event.organizationId,
      action: "webhook.retry_requested",
      targetType: "webhook_event",
      targetId: event.id,
      metadata: {
        previousStatus: event.processingStatus,
        processingAttempts: event.processingAttempts,
      },
    });
  });

  try {
    await webhookQueue.add(
      "process-meta-webhook",
      { eventId: event.id },
      { jobId: `webhook-${event.id}-manual-${now.getTime()}` },
    );
  } catch (error) {
    await db
      .update(schema.webhookEvents)
      .set({
        lastProcessingError: `Manual requeue failed: ${errorText(error)}`,
        nextRetryAt: now,
      })
      .where(eq(schema.webhookEvents.id, event.id));
    throw error;
  }

  revalidatePath("/admin/webhooks");
  revalidatePath("/admin/audit");
}
