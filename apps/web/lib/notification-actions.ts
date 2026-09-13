"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { schema } from "@wa/db";
import {
  NOTIFICATION_TYPES,
  isNotificationMandatory,
  markAllNotificationsRead,
  markNotificationRead,
} from "@wa/notifications";
import { requireAuthContext } from "./auth-context";
import { db } from "./server";

const uuid = z.string().uuid();

export async function markNotificationReadAction(formData: FormData) {
  const { workspace } = await requireAuthContext();
  const notificationId = uuid.parse(formData.get("notificationId"));
  await markNotificationRead(db, {
    organizationId: workspace.organizationId,
    userId: workspace.userId,
    notificationId,
  });
  revalidatePath("/notifications");
}

export async function markAllNotificationsReadAction() {
  const { workspace } = await requireAuthContext();
  await markAllNotificationsRead(db, {
    organizationId: workspace.organizationId,
    userId: workspace.userId,
  });
  revalidatePath("/notifications");
}

export async function updateNotificationPreferencesAction(formData: FormData) {
  const { workspace } = await requireAuthContext();
  const now = new Date();

  await db.transaction(async (tx) => {
    for (const type of NOTIFICATION_TYPES) {
      const mandatory = isNotificationMandatory(type);
      const inAppEnabled = mandatory || formData.has(`inApp:${type}`);
      const emailEnabled = mandatory || formData.has(`email:${type}`);
      await tx
        .insert(schema.notificationPreferences)
        .values({
          organizationId: workspace.organizationId,
          userId: workspace.userId,
          type,
          inAppEnabled,
          emailEnabled,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            schema.notificationPreferences.organizationId,
            schema.notificationPreferences.userId,
            schema.notificationPreferences.type,
          ],
          set: { inAppEnabled, emailEnabled, updatedAt: now },
        });
    }
  });

  revalidatePath("/settings/notifications");
}
