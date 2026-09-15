import { and, count, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { schema } from "@wa/db";
import type { NotificationDatabase } from "./database";

export async function getPendingEmailDeliveryIds(db: NotificationDatabase, limit = 500): Promise<string[]> {
  const rows = await db
    .select({ id: schema.notificationDeliveries.id })
    .from(schema.notificationDeliveries)
    .where(and(
      eq(schema.notificationDeliveries.channel, "email"),
      inArray(schema.notificationDeliveries.status, ["pending", "failed"]),
      or(isNull(schema.notificationDeliveries.nextRetryAt), lte(schema.notificationDeliveries.nextRetryAt, new Date())),
    ))
    .limit(Math.max(1, Math.min(limit, 2_000)));
  return rows.map((row) => row.id);
}

export async function getUnreadNotificationCount(db: NotificationDatabase, input: { organizationId: string; userId: string }): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(schema.notifications)
    .innerJoin(schema.notificationDeliveries, and(
      eq(schema.notificationDeliveries.notificationId, schema.notifications.id),
      eq(schema.notificationDeliveries.channel, "in_app"),
      eq(schema.notificationDeliveries.status, "sent"),
    ))
    .where(and(
      eq(schema.notifications.organizationId, input.organizationId),
      eq(schema.notifications.userId, input.userId),
      isNull(schema.notifications.readAt),
    ));
  return row?.total ?? 0;
}

export async function markNotificationRead(db: NotificationDatabase, input: { organizationId: string; userId: string; notificationId: string }) {
  return db
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(and(
      eq(schema.notifications.id, input.notificationId),
      eq(schema.notifications.organizationId, input.organizationId),
      eq(schema.notifications.userId, input.userId),
    ))
    .returning({ id: schema.notifications.id });
}

export async function markAllNotificationsRead(db: NotificationDatabase, input: { organizationId: string; userId: string }) {
  return db
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(and(
      eq(schema.notifications.organizationId, input.organizationId),
      eq(schema.notifications.userId, input.userId),
      isNull(schema.notifications.readAt),
    ))
    .returning({ id: schema.notifications.id });
}
