import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { and, count, eq } from "drizzle-orm";
import { createDatabase, schema } from "@wa/db";
import {
  NotificationService,
  deliverNotificationEmail,
  getUnreadNotificationCount,
  markNotificationRead,
  type EmailProvider,
} from "./index";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  test.skip("notification integration tests require DATABASE_URL", () => {});
} else {
  describe("notification service integration", () => {
    const database = createDatabase(databaseUrl);
    const db = database.db;
    const suffix = randomUUID().slice(0, 8);
    let organizationA = "";
    let organizationB = "";
    let userA = "";
    let userA2 = "";
    let userB = "";
    const queued: string[] = [];
    const service = new NotificationService({
      db,
      enqueueEmailDelivery: async (deliveryId) => { queued.push(deliveryId); },
    });

    beforeAll(async () => {
      const [orgA] = await db.insert(schema.organizations).values({ name: `Notifications A ${suffix}`, slug: `notifications-a-${suffix}` }).returning({ id: schema.organizations.id });
      const [orgB] = await db.insert(schema.organizations).values({ name: `Notifications B ${suffix}`, slug: `notifications-b-${suffix}` }).returning({ id: schema.organizations.id });
      if (!orgA || !orgB) throw new Error("Could not create notification test organizations");
      organizationA = orgA.id;
      organizationB = orgB.id;

      const users = await db.insert(schema.users).values([
        { externalAuthId: `notification-a-${suffix}`, email: `notification-a-${suffix}@example.test`, displayName: "A" },
        { externalAuthId: `notification-a2-${suffix}`, email: `notification-a2-${suffix}@example.test`, displayName: "A2" },
        { externalAuthId: `notification-b-${suffix}`, email: `notification-b-${suffix}@example.test`, displayName: "B" },
      ]).returning({ id: schema.users.id, email: schema.users.email });
      const first = users.find((row) => row.email.startsWith(`notification-a-${suffix}@`));
      const second = users.find((row) => row.email.startsWith(`notification-a2-${suffix}@`));
      const foreign = users.find((row) => row.email.startsWith(`notification-b-${suffix}@`));
      if (!first || !second || !foreign) throw new Error("Could not create notification test users");
      userA = first.id;
      userA2 = second.id;
      userB = foreign.id;

      await db.insert(schema.organizationMembers).values([
        { organizationId: organizationA, userId: userA, role: "owner" },
        { organizationId: organizationA, userId: userA2, role: "member" },
        { organizationId: organizationB, userId: userB, role: "owner" },
      ]);
      await db.insert(schema.workspacePreferences).values([
        { organizationId: organizationA, preferredLanguage: "en" },
        { organizationId: organizationB, preferredLanguage: "ar" },
      ]);
    });

    afterAll(async () => {
      if (organizationA) await db.delete(schema.organizations).where(eq(schema.organizations.id, organizationA));
      if (organizationB) await db.delete(schema.organizations).where(eq(schema.organizations.id, organizationB));
      if (userA) await db.delete(schema.users).where(eq(schema.users.id, userA));
      if (userA2) await db.delete(schema.users).where(eq(schema.users.id, userA2));
      if (userB) await db.delete(schema.users).where(eq(schema.users.id, userB));
      await database.client.end({ timeout: 5 });
    });

    test("targets the correct user and rejects foreign-tenant targets", async () => {
      const eventId = `target:${randomUUID()}`;
      const result = await service.emit({
        id: eventId,
        type: "campaign_completed",
        organizationId: organizationA,
        userIds: [userA],
        metadata: { campaignName: "September Leads" },
      });
      expect(result.notificationsCreated).toBe(1);

      const rows = await db.select({ userId: schema.notifications.userId }).from(schema.notifications).where(eq(schema.notifications.dedupeKey, eventId));
      expect(rows.map((row) => row.userId)).toEqual([userA]);

      const foreignResult = await service.emit({
        id: `foreign:${randomUUID()}`,
        type: "security_event",
        organizationId: organizationA,
        userIds: [userB],
      });
      expect(foreignResult.notificationsCreated).toBe(0);
    });

    test("respects optional preferences and overrides them for mandatory events", async () => {
      await db.insert(schema.notificationPreferences).values({
        organizationId: organizationA,
        userId: userA2,
        type: "campaign_completed",
        inAppEnabled: true,
        emailEnabled: false,
      });

      const optionalId = `preference:${randomUUID()}`;
      await service.emit({ id: optionalId, type: "campaign_completed", organizationId: organizationA, userIds: [userA2] });
      const optionalDeliveries = await db
        .select({ channel: schema.notificationDeliveries.channel, status: schema.notificationDeliveries.status })
        .from(schema.notificationDeliveries)
        .innerJoin(schema.notifications, eq(schema.notifications.id, schema.notificationDeliveries.notificationId))
        .where(eq(schema.notifications.dedupeKey, optionalId));
      expect(optionalDeliveries.find((row) => row.channel === "email")?.status).toBe("suppressed");
      expect(optionalDeliveries.find((row) => row.channel === "in_app")?.status).toBe("sent");

      await db.insert(schema.notificationPreferences).values({
        organizationId: organizationA,
        userId: userA2,
        type: "security_event",
        inAppEnabled: false,
        emailEnabled: false,
      });
      const mandatoryId = `mandatory:${randomUUID()}`;
      await service.emit({ id: mandatoryId, type: "security_event", organizationId: organizationA, userIds: [userA2] });
      const mandatoryDeliveries = await db
        .select({ channel: schema.notificationDeliveries.channel, status: schema.notificationDeliveries.status })
        .from(schema.notificationDeliveries)
        .innerJoin(schema.notifications, eq(schema.notifications.id, schema.notificationDeliveries.notificationId))
        .where(eq(schema.notifications.dedupeKey, mandatoryId));
      expect(mandatoryDeliveries.find((row) => row.channel === "email")?.status).toBe("pending");
      expect(mandatoryDeliveries.find((row) => row.channel === "in_app")?.status).toBe("sent");
    });

    test("tracks unread state and scopes read mutations to the user", async () => {
      const before = await getUnreadNotificationCount(db, { organizationId: organizationA, userId: userA });
      const eventId = `read:${randomUUID()}`;
      await service.emit({ id: eventId, type: "import_completed", organizationId: organizationA, userIds: [userA] });
      expect(await getUnreadNotificationCount(db, { organizationId: organizationA, userId: userA })).toBe(before + 1);

      const [notification] = await db.select({ id: schema.notifications.id }).from(schema.notifications).where(eq(schema.notifications.dedupeKey, eventId)).limit(1);
      if (!notification) throw new Error("Notification was not created");
      const foreignRead = await markNotificationRead(db, { organizationId: organizationA, userId: userA2, notificationId: notification.id });
      expect(foreignRead).toHaveLength(0);
      await markNotificationRead(db, { organizationId: organizationA, userId: userA, notificationId: notification.id });
      expect(await getUnreadNotificationCount(db, { organizationId: organizationA, userId: userA })).toBe(before);
    });

    test("deduplicates replayed domain events", async () => {
      const eventId = `dedupe:${randomUUID()}`;
      const event = { id: eventId, type: "campaign_failed" as const, organizationId: organizationA, userIds: [userA] };
      await service.emit(event);
      await service.emit(event);
      const [row] = await db.select({ total: count() }).from(schema.notifications).where(and(eq(schema.notifications.organizationId, organizationA), eq(schema.notifications.dedupeKey, eventId)));
      expect(row?.total).toBe(1);
    });

    test("records email failure and succeeds on retry", async () => {
      const eventId = `retry:${randomUUID()}`;
      queued.length = 0;
      await service.emit({ id: eventId, type: "campaign_completed", organizationId: organizationA, userIds: [userA] });
      const deliveryId = queued[0];
      if (!deliveryId) throw new Error("Email delivery was not queued");

      let calls = 0;
      const provider: EmailProvider = {
        async send() {
          calls += 1;
          if (calls === 1) throw new Error("temporary provider outage");
          return { messageId: "provider-message-1" };
        },
      };

      await expect(deliverNotificationEmail({ db, deliveryId, provider, finalAttempt: false })).rejects.toThrow("temporary provider outage");
      let [delivery] = await db.select({ status: schema.notificationDeliveries.status, attemptCount: schema.notificationDeliveries.attemptCount }).from(schema.notificationDeliveries).where(eq(schema.notificationDeliveries.id, deliveryId));
      expect(delivery?.status).toBe("failed");
      expect(delivery?.attemptCount).toBe(1);

      await deliverNotificationEmail({ db, deliveryId, provider, finalAttempt: false });
      [delivery] = await db.select({ status: schema.notificationDeliveries.status, attemptCount: schema.notificationDeliveries.attemptCount }).from(schema.notificationDeliveries).where(eq(schema.notificationDeliveries.id, deliveryId));
      expect(delivery?.status).toBe("sent");
      expect(delivery?.attemptCount).toBe(2);
    });

    test("handles bursty domain events without recipient-level fanout", async () => {
      const prefix = `burst:${randomUUID()}`;
      for (let index = 0; index < 50; index += 1) {
        await service.emit({
          id: `${prefix}:${index}`,
          type: "campaign_failed",
          organizationId: organizationA,
          userIds: [userA],
          metadata: { campaignName: `Burst ${index}`, failedRecipients: 15_000 },
        });
      }
      const [row] = await db.select({ total: count() }).from(schema.notifications).where(and(eq(schema.notifications.organizationId, organizationA), eq(schema.notifications.userId, userA)));
      expect((row?.total ?? 0) >= 50).toBe(true);
    });
  });
}
