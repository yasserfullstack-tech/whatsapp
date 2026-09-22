import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { and, count, eq } from "drizzle-orm";
import { createDatabase, schema } from "@wa/db";
import { NotificationService } from "@wa/notifications";
import { reconcileNotificationSources } from "./notification-sources";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for notification source integration tests");

async function seedOrganization(db: ReturnType<typeof createDatabase>["db"], suffix: string) {
  const [organization] = await db
    .insert(schema.organizations)
    .values({ name: `Notification sources ${suffix}`, slug: `notification-sources-${suffix}` })
    .returning({ id: schema.organizations.id });
  if (!organization) throw new Error("Could not create organization fixture");

  const [owner] = await db
    .insert(schema.users)
    .values({
      externalAuthId: `notification-sources-${suffix}`,
      email: `notification-sources-${suffix}@example.test`,
      displayName: "Owner",
    })
    .returning({ id: schema.users.id });
  if (!owner) throw new Error("Could not create user fixture");

  await db.insert(schema.organizationMembers).values({
    organizationId: organization.id,
    userId: owner.id,
    role: "owner",
  });

  return { organizationId: organization.id, ownerId: owner.id };
}

async function notificationCount(db: ReturnType<typeof createDatabase>["db"], dedupeKey: string) {
  const [row] = await db
    .select({ total: count() })
    .from(schema.notifications)
    .where(eq(schema.notifications.dedupeKey, dedupeKey));
  return row?.total ?? 0;
}

describe("notification durable source reconciliation", () => {
  test("emits a security event from a durable audit row exactly once across replays", async () => {
    const database = createDatabase(databaseUrl);
    const db = database.db;
    const suffix = randomUUID().slice(0, 8);
    const { organizationId, ownerId } = await seedOrganization(db, suffix);
    const notifications = new NotificationService({ db });

    try {
      const [audit] = await db
        .insert(schema.workspaceAuditLogs)
        .values({
          organizationId,
          actorUserId: ownerId,
          action: "security.account.password_changed",
        })
        .returning({ id: schema.workspaceAuditLogs.id });
      if (!audit) throw new Error("Could not create audit fixture");

      const since = new Date(Date.now() - 60_000);
      const first = await reconcileNotificationSources({ db, notifications, since });
      expect(first.workspace).toBeGreaterThan(0);

      const dedupeKey = `workspace-audit:${audit.id}`;
      expect(await notificationCount(db, dedupeKey)).toBe(1);

      const [notification] = await db
        .select({ type: schema.notifications.type, userId: schema.notifications.userId })
        .from(schema.notifications)
        .where(eq(schema.notifications.dedupeKey, dedupeKey))
        .limit(1);
      expect(notification?.type).toBe("security_event");
      expect(notification?.userId).toBe(ownerId);

      await reconcileNotificationSources({ db, notifications, since });
      expect(await notificationCount(db, dedupeKey)).toBe(1);
    } finally {
      await db.delete(schema.organizations).where(eq(schema.organizations.id, organizationId));
      await db.delete(schema.users).where(eq(schema.users.id, ownerId));
      await database.client.end({ timeout: 5 });
    }
  });

  test("replays a terminal campaign that the queue hook missed without duplicating it", async () => {
    const database = createDatabase(databaseUrl);
    const db = database.db;
    const suffix = randomUUID().slice(0, 8);
    const { organizationId, ownerId } = await seedOrganization(db, suffix);
    const notifications = new NotificationService({ db });

    try {
      const [phone] = await db
        .insert(schema.whatsappPhoneNumbers)
        .values({
          organizationId,
          wabaId: `waba-${suffix}`,
          phoneNumberId: `phone-${suffix}`,
          status: "connected",
          credentialKey: `org/${organizationId}/whatsapp/phone-${suffix}/access-token`,
        })
        .returning({ id: schema.whatsappPhoneNumbers.id });
      if (!phone) throw new Error("Could not create phone fixture");

      const [template] = await db
        .insert(schema.templates)
        .values({
          organizationId,
          wabaId: `waba-${suffix}`,
          name: `template-${suffix}`,
          category: "marketing",
        })
        .returning({ id: schema.templates.id });
      if (!template) throw new Error("Could not create template fixture");

      const [campaign] = await db
        .insert(schema.campaigns)
        .values({
          organizationId,
          whatsappPhoneNumberId: phone.id,
          templateId: template.id,
          name: `Campaign ${suffix}`,
          status: "completed",
        })
        .returning({ id: schema.campaigns.id });
      if (!campaign) throw new Error("Could not create campaign fixture");

      const since = new Date(Date.now() - 60_000);
      const first = await reconcileNotificationSources({ db, notifications, since });
      expect(first.campaigns).toBeGreaterThan(0);

      const dedupeKey = `campaign:${campaign.id}:completed`;
      expect(await notificationCount(db, dedupeKey)).toBe(1);

      await reconcileNotificationSources({ db, notifications, since });
      expect(await notificationCount(db, dedupeKey)).toBe(1);

      const rows = await db
        .select({ userId: schema.notifications.userId, type: schema.notifications.type })
        .from(schema.notifications)
        .where(and(eq(schema.notifications.organizationId, organizationId), eq(schema.notifications.dedupeKey, dedupeKey)));
      expect(rows).toEqual([{ userId: ownerId, type: "campaign_completed" }]);
    } finally {
      await db.delete(schema.organizations).where(eq(schema.organizations.id, organizationId));
      await db.delete(schema.users).where(eq(schema.users.id, ownerId));
      await database.client.end({ timeout: 5 });
    }
  });

  test("does not replay a contact-import failure that the queue may still retry", async () => {
    const database = createDatabase(databaseUrl);
    const db = database.db;
    const suffix = randomUUID().slice(0, 8);
    const { organizationId, ownerId } = await seedOrganization(db, suffix);
    const notifications = new NotificationService({ db });

    try {
      const importId = randomUUID();
      // `processContactImport` persists exactly this shape before rethrowing on
      // every attempt, so the row is not terminal while retries remain.
      await db.insert(schema.contactImports).values({
        id: importId,
        organizationId,
        originalFileName: `import-${suffix}.csv`,
        objectKey: `imports/${suffix}/import.csv`,
        sizeBytes: 128,
        defaultCountry: "US",
        optInSource: "manual",
        confirmedOptInAt: new Date(),
        status: "failed",
        errorMessage: "transient failure",
      });

      const since = new Date(Date.now() - 60_000);
      await reconcileNotificationSources({ db, notifications, since });

      expect(await notificationCount(db, `import:${importId}:failed`)).toBe(0);
      expect(await notificationCount(db, `import:${importId}:completed`)).toBe(0);
    } finally {
      await db.delete(schema.organizations).where(eq(schema.organizations.id, organizationId));
      await db.delete(schema.users).where(eq(schema.users.id, ownerId));
      await database.client.end({ timeout: 5 });
    }
  });

  test("replays a delayed payment failure using processing time rather than event creation time", async () => {
    const database = createDatabase(databaseUrl);
    const db = database.db;
    const suffix = randomUUID().slice(0, 8);
    const { organizationId, ownerId } = await seedOrganization(db, suffix);
    const notifications = new NotificationService({ db });
    const externalEventId = `evt-notification-${suffix}`;

    try {
      const [account] = await db
        .insert(schema.billingAccounts)
        .values({ organizationId })
        .returning({ id: schema.billingAccounts.id });
      if (!account) throw new Error("Could not create billing account fixture");

      const providerInvoiceId = `in-notification-${suffix}`;
      await db.insert(schema.billingInvoices).values({
        organizationId,
        billingAccountId: account.id,
        providerKey: "stripe",
        providerInvoiceId,
        status: "open",
      });

      const processedAt = new Date();
      const createdAt = new Date(processedAt.getTime() - 10 * 60_000);
      const [providerEvent] = await db
        .insert(schema.billingProviderEvents)
        .values({
          providerKey: "stripe",
          externalEventId,
          eventType: "invoice.payment_failed",
          payload: { data: { object: { id: providerInvoiceId } } },
          verifiedAt: processedAt,
          processedAt,
          createdAt,
        })
        .returning({ id: schema.billingProviderEvents.id });
      if (!providerEvent) throw new Error("Could not create provider event fixture");

      const since = new Date(processedAt.getTime() - 60_000);
      const result = await reconcileNotificationSources({ db, notifications, since });

      expect(result.payments).toBeGreaterThan(0);
      expect(await notificationCount(db, `billing-provider:${providerEvent.id}`)).toBe(1);
    } finally {
      await db.delete(schema.billingProviderEvents).where(eq(schema.billingProviderEvents.externalEventId, externalEventId));
      await db.delete(schema.organizations).where(eq(schema.organizations.id, organizationId));
      await db.delete(schema.users).where(eq(schema.users.id, ownerId));
      await database.client.end({ timeout: 5 });
    }
  });

});
