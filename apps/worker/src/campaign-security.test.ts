import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { createDatabase, schema } from "@wa/db";
import { claimCampaignRecipientForSend } from "./campaign-security";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for campaign security tests");

describe("campaign send queue tenant boundary", () => {
  test("a forged send job cannot claim another organization's recipient", async () => {
    const database = createDatabase(databaseUrl);
    const db = database.db;
    const suffix = randomUUID();
    const organizations = await db.insert(schema.organizations).values([
      { name: `Queue attacker ${suffix}`, slug: `queue-attacker-${suffix}` },
      { name: `Queue victim ${suffix}`, slug: `queue-victim-${suffix}` },
    ]).returning({ id: schema.organizations.id });
    const [attacker, victim] = organizations;
    if (!attacker || !victim) throw new Error("Could not create organization fixtures");

    try {
      const [phone] = await db.insert(schema.whatsappPhoneNumbers).values({
        organizationId: victim.id,
        wabaId: `waba-${suffix}`,
        phoneNumberId: `phone-${suffix}`,
        status: "connected",
        credentialKey: `org/${victim.id}/whatsapp/phone-${suffix}/access-token`,
      }).returning({ id: schema.whatsappPhoneNumbers.id, wabaId: schema.whatsappPhoneNumbers.wabaId });
      if (!phone) throw new Error("Could not create phone fixture");

      const [template] = await db.insert(schema.templates).values({
        organizationId: victim.id,
        wabaId: phone.wabaId,
        metaTemplateId: `template-${suffix}`,
        name: `template_${suffix.replaceAll("-", "").slice(0, 20)}`,
        language: "en",
        category: "marketing",
        status: "approved",
        components: [],
      }).returning({ id: schema.templates.id });
      const [contact] = await db.insert(schema.contacts).values({
        organizationId: victim.id,
        phoneE164: "+15550009999",
        optedIn: true,
      }).returning({ id: schema.contacts.id });
      if (!template || !contact) throw new Error("Could not create campaign fixtures");

      const [campaign] = await db.insert(schema.campaigns).values({
        organizationId: victim.id,
        whatsappPhoneNumberId: phone.id,
        templateId: template.id,
        name: `Victim campaign ${suffix}`,
        status: "sending",
      }).returning({ id: schema.campaigns.id });
      if (!campaign) throw new Error("Could not create campaign fixture");

      const [recipient] = await db.insert(schema.campaignRecipients).values({
        organizationId: victim.id,
        campaignId: campaign.id,
        contactId: contact.id,
        phoneE164: "+15550009999",
        status: "queued",
      }).returning({ id: schema.campaignRecipients.id });
      if (!recipient) throw new Error("Could not create recipient fixture");

      const forged = await claimCampaignRecipientForSend(db, {
        organizationId: attacker.id,
        campaignId: campaign.id,
        recipientId: recipient.id,
        now: new Date(),
      });
      expect(forged).toBeNull();

      const untouched = await db.select({
        status: schema.campaignRecipients.status,
        attemptCount: schema.campaignRecipients.attemptCount,
      }).from(schema.campaignRecipients)
        .where(and(
          eq(schema.campaignRecipients.id, recipient.id),
          eq(schema.campaignRecipients.organizationId, victim.id),
        ));
      expect(untouched).toEqual([{ status: "queued", attemptCount: 0 }]);

      const legitimate = await claimCampaignRecipientForSend(db, {
        organizationId: victim.id,
        campaignId: campaign.id,
        recipientId: recipient.id,
        now: new Date(),
      });
      expect(legitimate?.id).toBe(recipient.id);
      expect(legitimate?.phoneE164).toBe("+15550009999");
    } finally {
      await db.delete(schema.organizations).where(eq(schema.organizations.id, attacker.id));
      await db.delete(schema.organizations).where(eq(schema.organizations.id, victim.id));
      await database.client.end({ timeout: 5 });
    }
  });
});
