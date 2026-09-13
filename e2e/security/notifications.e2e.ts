import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { schema } from "../../packages/db/src/index";
import { createSecurityTenant, destroySecurityTenant, securityDb, type SecurityTenant } from "./security-helpers";

test.describe.serial("notification tenant isolation", () => {
  let tenantA: SecurityTenant;
  let tenantB: SecurityTenant;

  test.beforeAll(async () => {
    tenantA = await createSecurityTenant("notifications-a");
    tenantB = await createSecurityTenant("notifications-b");

    const [notification] = await securityDb.insert(schema.notifications).values({
      organizationId: tenantB.organizationId,
      userId: tenantB.appUserId,
      type: "security_event",
      title: "Tenant B only",
      message: "This must never affect tenant A's unread count.",
      dedupeKey: "security-notification-tenant-b",
    }).returning({ id: schema.notifications.id });
    if (!notification) throw new Error("Could not seed tenant B notification");
    await securityDb.insert(schema.notificationDeliveries).values({
      notificationId: notification.id,
      organizationId: tenantB.organizationId,
      userId: tenantB.appUserId,
      channel: "in_app",
      status: "sent",
      sentAt: new Date(),
    });
  });

  test.afterAll(async () => {
    await destroySecurityTenant(tenantA);
    await destroySecurityTenant(tenantB);
  });

  test("unread count is scoped to the authenticated user and organization", async () => {
    const responseA = await tenantA.api.get("/api/notifications/unread-count");
    expect(responseA.status()).toBe(200);
    expect(await responseA.json()).toEqual({ unread: 0 });

    const responseB = await tenantB.api.get("/api/notifications/unread-count");
    expect(responseB.status()).toBe(200);
    expect(await responseB.json()).toEqual({ unread: 1 });
  });

  test("anonymous callers cannot inspect unread notification state", async ({ request }) => {
    const response = await request.get("/api/notifications/unread-count");
    expect(response.status()).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  test("deleting tenant B notification does not require or expose tenant A data", async () => {
    const rows = await securityDb.select({ id: schema.notifications.id }).from(schema.notifications).where(eq(schema.notifications.organizationId, tenantB.organizationId));
    expect(rows).toHaveLength(1);
  });
});
