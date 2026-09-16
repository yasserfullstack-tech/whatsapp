import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { createDatabase, schema } from "@wa/db";
import { claimDueScheduledCampaigns } from "./campaign-scheduling";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for campaign scheduling tests");

describe("scheduled campaign claiming", () => {
  test("does not claim early/cancelled campaigns and concurrent scheduler runs claim a due campaign once", async () => {
    const database = createDatabase(databaseUrl);
    const db = database.db;
    const suffix = randomUUID();
    const now = new Date("2026-01-15T12:00:00.000Z");

    const [organization] = await db.insert(schema.organizations).values({
      name: `Scheduling ${suffix}`,
      slug: `scheduling-${suffix}`,
    }).returning({ id: schema.organizations.id });
    if (!organization) throw new Error("Could not create organization fixture");

    try {
      const [phone] = await db.insert(schema.whatsappPhoneNumbers).values({
        organizationId: organization.id,
        wabaId: `waba-${suffix}`,
        phoneNumberId: `phone-${suffix}`,
        status: "connected",
        credentialKey: `org/${organization.id}/whatsapp/phone-${suffix}/access-token`,
      }).returning({ id: schema.whatsappPhoneNumbers.id, wabaId: schema.whatsappPhoneNumbers.wabaId });
      if (!phone) throw new Error("Could not create phone fixture");

      const [template] = await db.insert(schema.templates).values({
        organizationId: organization.id,
        wabaId: phone.wabaId,
        metaTemplateId: `template-${suffix}`,
        name: `template_${suffix.replaceAll("-", "").slice(0, 20)}`,
        language: "en",
        category: "marketing",
        status: "approved",
        components: [],
      }).returning({ id: schema.templates.id });
      if (!template) throw new Error("Could not create template fixture");

      const rows = await db.insert(schema.campaigns).values([
        {
          organizationId: organization.id,
          whatsappPhoneNumberId: phone.id,
          templateId: template.id,
          name: "Due campaign",
          status: "scheduled",
          scheduledAt: new Date(now.getTime() - 60_000),
        },
        {
          organizationId: organization.id,
          whatsappPhoneNumberId: phone.id,
          templateId: template.id,
          name: "Future campaign",
          status: "scheduled",
          scheduledAt: new Date(now.getTime() + 60_000),
        },
        {
          organizationId: organization.id,
          whatsappPhoneNumberId: phone.id,
          templateId: template.id,
          name: "Cancelled campaign",
          status: "cancelled",
          scheduledAt: new Date(now.getTime() - 60_000),
        },
      ]).returning({ id: schema.campaigns.id, name: schema.campaigns.name });

      const due = rows.find((row) => row.name === "Due campaign");
      const future = rows.find((row) => row.name === "Future campaign");
      const cancelled = rows.find((row) => row.name === "Cancelled campaign");
      if (!due || !future || !cancelled) throw new Error("Could not create campaign fixtures");

      const [first, second] = await Promise.all([
        claimDueScheduledCampaigns(db, now),
        claimDueScheduledCampaigns(db, now),
      ]);
      const claimedIds = [...first, ...second].map((row) => row.id);
      expect(claimedIds.filter((id) => id === due.id)).toHaveLength(1);
      expect(claimedIds).not.toContain(future.id);
      expect(claimedIds).not.toContain(cancelled.id);

      const afterFirstClaim = await db.select({ id: schema.campaigns.id, status: schema.campaigns.status })
        .from(schema.campaigns)
        .where(inArray(schema.campaigns.id, [due.id, future.id, cancelled.id]));
      expect(afterFirstClaim.find((row) => row.id === due.id)?.status).toBe("dispatching");
      expect(afterFirstClaim.find((row) => row.id === future.id)?.status).toBe("scheduled");
      expect(afterFirstClaim.find((row) => row.id === cancelled.id)?.status).toBe("cancelled");

      await db.update(schema.campaigns)
        .set({ scheduledAt: new Date(now.getTime() - 1_000) })
        .where(eq(schema.campaigns.id, future.id));
      const rescheduledClaim = await claimDueScheduledCampaigns(db, now);
      expect(rescheduledClaim.map((row) => row.id)).toContain(future.id);
      expect(await claimDueScheduledCampaigns(db, now)).toEqual([]);
    } finally {
      await db.delete(schema.organizations).where(eq(schema.organizations.id, organization.id));
      await database.client.end({ timeout: 5 });
    }
  });
});
