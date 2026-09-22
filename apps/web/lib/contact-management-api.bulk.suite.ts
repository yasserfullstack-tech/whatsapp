import { describe, expect, test } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import {
  authContext,
  bulkRoute,
  contactDetailRoute,
  contactsRoute,
  createContact,
  createWorkspace,
  db,
  importPresignRoute,
  jsonRequest,
  mergeRoute,
  nextPhone,
  randomUUID,
  readContact,
  resubscribeRoute,
  routeParams,
  schema,
  suppressRoute,
  type ContactRow,
} from "./contact-management-api.integration.fixtures";

describe("contact management — bulk actions", () => {
  test("bulk tag actions apply to every contact and record activity", async () => {
    const workspace = await createWorkspace();
    workspace.actAs();
    try {
      const contacts = [await createContact(nextPhone()), await createContact(nextPhone()), await createContact(nextPhone())];
      const ids = contacts.map((contact) => contact.id);

      const added = await bulkRoute.POST(jsonRequest("/api/contacts/bulk", "POST", { contactIds: ids, action: "add_tag", tag: "spring" }));
      expect(added.status).toBe(200);
      expect((await added.json() as { affected: number }).affected).toBe(3);
      for (const contact of contacts) {
        expect((await readContact(contact.id)).tags).toEqual(["spring"]);
      }

      const removed = await bulkRoute.POST(jsonRequest("/api/contacts/bulk", "POST", { contactIds: ids, action: "remove_tag", tag: "spring" }));
      expect(removed.status).toBe(200);
      for (const contact of contacts) {
        const detail = await readContact(contact.id);
        expect(detail.tags).toEqual([]);
        expect(detail.activities.map((event) => event.eventType)).toEqual([
          "contact.bulk_tag_removed",
          "contact.bulk_tag_added",
          "contact.created",
        ]);
      }

      const missingTag = await bulkRoute.POST(jsonRequest("/api/contacts/bulk", "POST", { contactIds: ids, action: "add_tag" }));
      expect(missingTag.status).toBe(400);
    } finally {
      await workspace.cleanup();
    }
  });

  test("bulk suppression writes the suppression list, consent history and skips queued recipients", async () => {
    const workspace = await createWorkspace();
    workspace.actAs();
    try {
      const contact = await createContact(nextPhone());
      const [number] = await db.insert(schema.whatsappPhoneNumbers).values({
        organizationId: workspace.organizationId,
        wabaId: `waba-${randomUUID()}`,
        phoneNumberId: `phone-${randomUUID()}`,
        credentialKey: `credential-${randomUUID()}`,
      }).returning();
      const [template] = await db.insert(schema.templates).values({
        organizationId: workspace.organizationId,
        wabaId: `waba-${randomUUID()}`,
        name: `template_${randomUUID().replaceAll("-", "_")}`,
        category: "utility",
      }).returning();
      if (!number || !template) throw new Error("Failed to create campaign fixtures");
      const [campaign] = await db.insert(schema.campaigns).values({
        organizationId: workspace.organizationId,
        whatsappPhoneNumberId: number.id,
        templateId: template.id,
        name: "Bulk suppression campaign",
      }).returning();
      if (!campaign) throw new Error("Failed to create campaign fixture");
      const [recipient] = await db.insert(schema.campaignRecipients).values({
        organizationId: workspace.organizationId,
        campaignId: campaign.id,
        contactId: contact.id,
        phoneE164: contact.phoneE164,
        status: "pending",
      }).returning();
      if (!recipient) throw new Error("Failed to create recipient fixture");

      const response = await bulkRoute.POST(jsonRequest("/api/contacts/bulk", "POST", {
        contactIds: [contact.id, contact.id],
        action: "suppress",
        reason: "Customer asked to stop",
      }));
      expect(response.status).toBe(200);
      expect((await response.json() as { affected: number }).affected).toBe(1);

      const detail = await readContact(contact.id);
      expect(detail.contact.optedIn).toBe(false);
      expect(detail.contact.unsubscribedAt).not.toBeNull();
      expect(detail.activities.map((event) => event.eventType)).toContain("contact.bulk_suppressed");

      const suppressions = await db.select().from(schema.suppressionList).where(and(
        eq(schema.suppressionList.organizationId, workspace.organizationId),
        eq(schema.suppressionList.phoneE164, contact.phoneE164),
      ));
      expect(suppressions).toHaveLength(1);
      expect(suppressions[0]?.source).toBe("dashboard_bulk");
      expect(suppressions[0]?.reason).toBe("Customer asked to stop");

      const consentEvents = await db.select().from(schema.contactConsentEvents).where(and(
        eq(schema.contactConsentEvents.organizationId, workspace.organizationId),
        eq(schema.contactConsentEvents.contactId, contact.id),
      ));
      expect(consentEvents.map((event) => event.eventType)).toEqual(["manual_suppression"]);

      const [updatedRecipient] = await db.select({ status: schema.campaignRecipients.status, errorCode: schema.campaignRecipients.errorCode })
        .from(schema.campaignRecipients).where(eq(schema.campaignRecipients.id, recipient.id));
      expect(updatedRecipient?.status).toBe("skipped");
      expect(updatedRecipient?.errorCode).toBe("SUPPRESSED");
    } finally {
      await workspace.cleanup();
    }
  });

  test("bulk actions refuse unknown ids, foreign-workspace ids and merged sources", async () => {
    const workspace = await createWorkspace();
    const other = await createWorkspace();
    workspace.actAs();
    try {
      const contact = await createContact(nextPhone());
      const foreign = await (async () => {
        other.actAs();
        const created = await createContact(nextPhone());
        workspace.actAs();
        return created;
      })();

      expect((await bulkRoute.POST(jsonRequest("/api/contacts/bulk", "POST", {
        contactIds: [randomUUID()], action: "add_tag", tag: "x",
      }))).status).toBe(404);

      expect((await bulkRoute.POST(jsonRequest("/api/contacts/bulk", "POST", {
        contactIds: [foreign.id], action: "add_tag", tag: "x",
      }))).status).toBe(404);

      const target = await createContact(nextPhone());
      const merged = await mergeRoute.POST(jsonRequest("/api/contacts/merge", "POST", {
        targetContactId: target.id,
        sourceContactIds: [contact.id],
      }));
      expect(merged.status).toBe(200);

      expect((await bulkRoute.POST(jsonRequest("/api/contacts/bulk", "POST", {
        contactIds: [contact.id], action: "add_tag", tag: "x",
      }))).status).toBe(409);
    } finally {
      await workspace.cleanup();
      await other.cleanup();
    }
  });
});
