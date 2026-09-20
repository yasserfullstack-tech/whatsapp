import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { and, count, eq, inArray } from "drizzle-orm";
import { createDatabase, schema } from "@wa/db";
import { buildEligibleAudiencePredicate, normalizeAudienceDefinition } from "@wa/db";
import { cancelScheduledCampaign, rescheduleCampaign } from "@wa/db";
import { claimDueScheduledCampaigns } from "./campaign-scheduling";
import { checkCampaignDeferral, createRecipientSnapshot } from "./campaigns";

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

  test("dispatcher defers when campaign is still scheduled", async () => {
    const now = new Date("2026-01-15T12:00:00.000Z");
    const result = checkCampaignDeferral("scheduled", new Date(now.getTime() + 60_000));
    expect(result).toEqual({ deferred: true, scheduledAt: new Date(now.getTime() + 60_000).toISOString() });

    const notDeferred = checkCampaignDeferral("dispatching", new Date(now.getTime() - 60_000));
    expect(notDeferred).toEqual({ deferred: false });
  });

  test("cancel and reschedule are rejected once campaign transitions to dispatching", async () => {
    const database = createDatabase(databaseUrl);
    const db = database.db;
    const suffix = randomUUID();
    const now = new Date("2026-01-15T12:00:00.000Z");

    const [organization] = await db.insert(schema.organizations).values({
      name: `CancelRace ${suffix}`,
      slug: `cancel-race-${suffix}`,
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

      const [campaign] = await db.insert(schema.campaigns).values({
        organizationId: organization.id,
        whatsappPhoneNumberId: phone.id,
        templateId: template.id,
        name: "Due for dispatch",
        status: "scheduled",
        scheduledAt: new Date(now.getTime() - 60_000),
      }).returning({ id: schema.campaigns.id });
      if (!campaign) throw new Error("Could not create campaign fixture");

      await claimDueScheduledCampaigns(db, now);

      const cancelResult = await cancelScheduledCampaign(db, campaign.id, organization.id);
      expect(cancelResult.success).toBe(false);
      if (!cancelResult.success) {
        expect(cancelResult.error).toBe("not-scheduled");
        expect(cancelResult.status).toBe("dispatching");
      }

      const rescheduleResult = await rescheduleCampaign(db, campaign.id, organization.id, new Date(now.getTime() + 120_000));
      expect(rescheduleResult.success).toBe(false);
      if (!rescheduleResult.success) {
        expect(rescheduleResult.error).toBe("not-scheduled");
        expect(rescheduleResult.status).toBe("dispatching");
      }

      const [final] = await db.select({ status: schema.campaigns.status })
        .from(schema.campaigns)
        .where(eq(schema.campaigns.id, campaign.id))
        .limit(1);
      expect(final?.status).toBe("dispatching");
    } finally {
      await db.delete(schema.organizations).where(eq(schema.organizations.id, organization.id));
      await database.client.end({ timeout: 5 });
    }
  });

  test("duplicate dispatcher jobs cannot create duplicate recipients", async () => {
    const database = createDatabase(databaseUrl);
    const db = database.db;
    const suffix = randomUUID();
    const now = new Date("2026-01-15T12:00:00.000Z");

    const [organization] = await db.insert(schema.organizations).values({
      name: `DupDispatch ${suffix}`,
      slug: `dup-dispatch-${suffix}`,
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

      await db.insert(schema.contacts).values([
        { organizationId: organization.id, phoneE164: "+15550001111", optedIn: true, displayName: "Contact 1" },
        { organizationId: organization.id, phoneE164: "+15550002222", optedIn: true, displayName: "Contact 2" },
      ]);

      const [campaign] = await db.insert(schema.campaigns).values({
        organizationId: organization.id,
        whatsappPhoneNumberId: phone.id,
        templateId: template.id,
        name: "Campaign for duplicate dispatch test",
        status: "dispatching",
        scheduledAt: new Date(now.getTime() - 60_000),
      }).returning({ id: schema.campaigns.id });
      if (!campaign) throw new Error("Could not create campaign fixture");

      await db.insert(schema.campaignAudiences).values({
        organizationId: organization.id,
        campaignId: campaign.id,
        type: "all",
        sourceId: null,
        sourceName: "All contacts",
        definition: { type: "all" },
      });

      const audienceDefinition = normalizeAudienceDefinition({ type: "all" });

      const result1 = await createRecipientSnapshot(db, campaign.id, organization.id, audienceDefinition);
      expect("snapshotCreated" in result1).toBe(true);
      if ("snapshotCreated" in result1) {
        expect(result1.recipientCount).toBe(2);
      }

      const result2 = await createRecipientSnapshot(db, campaign.id, organization.id, audienceDefinition);
      expect("snapshotCreated" in result2).toBe(true);
      if ("snapshotCreated" in result2) {
        expect(result2.recipientCount).toBe(2);
      }

      const [countResult] = await db.select({ total: count() })
        .from(schema.campaignRecipients)
        .where(and(
          eq(schema.campaignRecipients.campaignId, campaign.id),
          eq(schema.campaignRecipients.organizationId, organization.id),
        ));
      expect(countResult?.total).toBe(2);
    } finally {
      await db.delete(schema.organizations).where(eq(schema.organizations.id, organization.id));
      await database.client.end({ timeout: 5 });
    }
  });
});