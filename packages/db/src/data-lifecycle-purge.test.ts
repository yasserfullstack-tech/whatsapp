import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { count, eq } from "drizzle-orm";
import { createDatabase, schema } from "./index";

describe("workspace relational purge", () => {
  test("deleting an organization removes realistic tenant data while retaining deletion evidence", async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) return;
    const database = createDatabase(databaseUrl);
    const db = database.db;
    const suffix = randomUUID();

    try {
      const [user] = await db.insert(schema.users).values({
        externalAuthId: `purge-${suffix}`,
        email: `purge-${suffix}@example.com`,
        displayName: "Purge Owner",
      }).returning();
      const [organization] = await db.insert(schema.organizations).values({
        name: "Purge Test Workspace",
        slug: `purge-test-${suffix}`,
      }).returning();
      if (!user || !organization) throw new Error("Failed to create purge fixtures");

      await db.insert(schema.organizationMembers).values({ organizationId: organization.id, userId: user.id, role: "owner" });
      await db.insert(schema.credentialSecrets).values({
        organizationId: organization.id,
        key: `credential-${suffix}`,
        ciphertext: "ciphertext",
        iv: "iv",
        authTag: "tag",
      });
      const [number] = await db.insert(schema.whatsappPhoneNumbers).values({
        organizationId: organization.id,
        wabaId: `waba-${suffix}`,
        phoneNumberId: `phone-${suffix}`,
        credentialKey: `credential-${suffix}`,
      }).returning();
      const [contact] = await db.insert(schema.contacts).values({
        organizationId: organization.id,
        phoneE164: `+1555${Math.floor(Math.random() * 9_000_000 + 1_000_000)}`,
        displayName: "Deletion Fixture",
        optedIn: true,
      }).returning();
      const [template] = await db.insert(schema.templates).values({
        organizationId: organization.id,
        wabaId: `waba-${suffix}`,
        name: `template_${suffix.replaceAll("-", "_")}`,
        category: "utility",
      }).returning();
      if (!number || !contact || !template) throw new Error("Failed to create relational fixtures");
      const [campaign] = await db.insert(schema.campaigns).values({
        organizationId: organization.id,
        whatsappPhoneNumberId: number.id,
        templateId: template.id,
        name: "Purge campaign",
      }).returning();
      if (!campaign) throw new Error("Failed to create campaign fixture");
      await db.insert(schema.campaignRecipients).values({
        organizationId: organization.id,
        campaignId: campaign.id,
        contactId: contact.id,
        phoneE164: contact.phoneE164,
      });
      const [list] = await db.insert(schema.contactLists).values({ organizationId: organization.id, name: `List ${suffix}` }).returning();
      if (!list) throw new Error("Failed to create list fixture");
      await db.insert(schema.contactListMembers).values({ organizationId: organization.id, listId: list.id, contactId: contact.id });
      await db.insert(schema.audienceSegments).values({ organizationId: organization.id, name: `Segment ${suffix}`, filters: [] });
      await db.insert(schema.campaignAudiences).values({
        organizationId: organization.id,
        campaignId: campaign.id,
        type: "all",
        sourceName: "All contacts",
        definition: { type: "all" },
      });
      await db.insert(schema.suppressionList).values({ organizationId: organization.id, phoneE164: contact.phoneE164, source: "test" });
      await db.insert(schema.contactConsentEvents).values({
        organizationId: organization.id,
        contactId: contact.id,
        phoneE164: contact.phoneE164,
        eventType: "opt_in",
        source: "test",
        actorUserId: user.id,
      });
      await db.insert(schema.contactImports).values({
        id: randomUUID(),
        organizationId: organization.id,
        listId: list.id,
        originalFileName: "contacts.csv",
        objectKey: `${organization.id}/contact-imports/${randomUUID()}.csv`,
        sizeBytes: 128,
        defaultCountry: "US",
        optInSource: "fixture",
        confirmedOptInAt: new Date(),
        status: "completed",
        completedAt: new Date(),
      });
      await db.insert(schema.dataRetentionPolicies).values({ organizationId: organization.id });
      await db.insert(schema.dataExportJobs).values({
        organizationId: organization.id,
        requestedByUserId: user.id,
        kind: "workspace",
        objectKey: `${organization.id}/data-exports/${randomUUID()}/${randomUUID()}.ndjson`,
        fileName: "workspace.ndjson",
      });
      const [deletion] = await db.insert(schema.workspaceDeletionRequests).values({
        organizationId: organization.id,
        requestedByUserId: user.id,
        coolingOffEndsAt: new Date(Date.now() + 86_400_000),
        purgeAfter: new Date(Date.now() + 2 * 86_400_000),
      }).returning();

      await db.delete(schema.organizations).where(eq(schema.organizations.id, organization.id));

      for (const table of [
        schema.organizationMembers,
        schema.credentialSecrets,
        schema.whatsappPhoneNumbers,
        schema.contacts,
        schema.templates,
        schema.campaigns,
        schema.campaignRecipients,
        schema.contactLists,
        schema.contactListMembers,
        schema.audienceSegments,
        schema.campaignAudiences,
        schema.suppressionList,
        schema.contactConsentEvents,
        schema.contactImports,
        schema.dataRetentionPolicies,
        schema.dataExportJobs,
      ] as const) {
        const rows = await db.select({ total: count() }).from(table).where(eq(table.organizationId, organization.id));
        expect(rows[0]?.total ?? 0).toBe(0);
      }

      const evidence = deletion
        ? await db.select().from(schema.workspaceDeletionRequests).where(eq(schema.workspaceDeletionRequests.id, deletion.id))
        : [];
      expect(evidence).toHaveLength(1);
      await db.delete(schema.workspaceDeletionRequests).where(eq(schema.workspaceDeletionRequests.organizationId, organization.id));
      await db.delete(schema.users).where(eq(schema.users.id, user.id));
    } finally {
      await database.client.end();
    }
  });
});
