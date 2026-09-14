import { and, eq, inArray } from "drizzle-orm";
import { schema } from "@wa/db";
import { defaultNotificationLink, notificationCopy } from "./copy";
import type { NotificationDatabase } from "./database";
import { resolveNotificationChannels } from "./definitions";
import type { DomainEvent, NotificationLocale } from "./types";

export class NotificationService {
  constructor(private readonly input: {
    db: NotificationDatabase;
    enqueueEmailDelivery?: (deliveryId: string) => Promise<void>;
    onEnqueueError?: (error: unknown, deliveryId: string) => void;
  }) {}

  async emit(event: DomainEvent): Promise<{ notificationsCreated: number; emailDeliveriesQueued: number }> {
    const metadata = event.metadata ?? {};
    if (event.userIds && event.userIds.length === 0) return { notificationsCreated: 0, emailDeliveriesQueued: 0 };

    const recipientPredicate = event.userIds
      ? and(eq(schema.organizationMembers.organizationId, event.organizationId), inArray(schema.users.id, event.userIds))
      : eq(schema.organizationMembers.organizationId, event.organizationId);

    const recipients = await this.input.db
      .select({ userId: schema.users.id })
      .from(schema.organizationMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.organizationMembers.userId))
      .where(recipientPredicate);
    if (!recipients.length) return { notificationsCreated: 0, emailDeliveriesQueued: 0 };

    const userIds = recipients.map((recipient) => recipient.userId);
    const [localeRow, preferences] = await Promise.all([
      this.input.db
        .select({ preferredLanguage: schema.workspacePreferences.preferredLanguage })
        .from(schema.workspacePreferences)
        .where(eq(schema.workspacePreferences.organizationId, event.organizationId))
        .limit(1)
        .then((rows) => rows[0]),
      this.input.db
        .select({
          userId: schema.notificationPreferences.userId,
          inAppEnabled: schema.notificationPreferences.inAppEnabled,
          emailEnabled: schema.notificationPreferences.emailEnabled,
        })
        .from(schema.notificationPreferences)
        .where(and(
          eq(schema.notificationPreferences.organizationId, event.organizationId),
          eq(schema.notificationPreferences.type, event.type),
          inArray(schema.notificationPreferences.userId, userIds),
        )),
    ]);

    const locale: NotificationLocale = localeRow?.preferredLanguage === "ar" ? "ar" : "en";
    const copy = notificationCopy(event.type, locale, metadata);
    const preferenceByUser = new Map(preferences.map((preference) => [preference.userId, preference]));
    const emailDeliveryIds: string[] = [];
    let notificationsCreated = 0;

    await this.input.db.transaction(async (tx) => {
      for (const recipient of recipients) {
        const channels = resolveNotificationChannels(event.type, preferenceByUser.get(recipient.userId));
        const inserted = await tx
          .insert(schema.notifications)
          .values({
            organizationId: event.organizationId,
            userId: recipient.userId,
            type: event.type,
            title: copy.title,
            message: copy.message,
            metadata: { ...metadata, locale, occurredAt: (event.occurredAt ?? new Date()).toISOString() },
            link: event.link === undefined ? defaultNotificationLink(event.type, metadata) : event.link,
            dedupeKey: event.id,
          })
          .onConflictDoNothing({
            target: [schema.notifications.organizationId, schema.notifications.userId, schema.notifications.dedupeKey],
          })
          .returning({ id: schema.notifications.id });
        const notification = inserted[0];
        if (!notification) continue;
        notificationsCreated += 1;

        const deliveryRows = await tx
          .insert(schema.notificationDeliveries)
          .values([
            {
              notificationId: notification.id,
              organizationId: event.organizationId,
              userId: recipient.userId,
              channel: "in_app",
              status: channels.inApp ? "sent" : "suppressed",
              sentAt: channels.inApp ? new Date() : null,
            },
            {
              notificationId: notification.id,
              organizationId: event.organizationId,
              userId: recipient.userId,
              channel: "email",
              status: channels.email ? "pending" : "suppressed",
            },
          ])
          .returning({ id: schema.notificationDeliveries.id, channel: schema.notificationDeliveries.channel, status: schema.notificationDeliveries.status });
        for (const delivery of deliveryRows) {
          if (delivery.channel === "email" && delivery.status === "pending") emailDeliveryIds.push(delivery.id);
        }
      }
    });

    let emailDeliveriesQueued = 0;
    if (this.input.enqueueEmailDelivery) {
      for (const deliveryId of emailDeliveryIds) {
        try {
          await this.input.enqueueEmailDelivery(deliveryId);
          emailDeliveriesQueued += 1;
        } catch (error) {
          this.input.onEnqueueError?.(error, deliveryId);
        }
      }
    }

    return { notificationsCreated, emailDeliveriesQueued };
  }
}
