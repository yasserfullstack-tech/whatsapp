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

describe("contact management — suppression and consent invariants", () => {
  test("manual suppression records consent history and resubscribe requires fresh evidence", async () => {
    const workspace = await createWorkspace();
    workspace.actAs();
    try {
      const contact = await createContact(nextPhone());

      expect((await suppressRoute.POST(jsonRequest("/api/contacts/x/suppress", "POST", {
        reason: "Customer requested removal",
      }), routeParams(contact.id))).status).toBe(200);

      const suppressed = await readContact(contact.id);
      expect(suppressed.contact.optedIn).toBe(false);
      expect(suppressed.contact.unsubscribedAt).not.toBeNull();

      const [suppression] = await db.select().from(schema.suppressionList).where(and(
        eq(schema.suppressionList.organizationId, workspace.organizationId),
        eq(schema.suppressionList.phoneE164, contact.phoneE164),
      ));
      expect(suppression?.source).toBe("dashboard_manual");
      const suppressedAt = suppression!.suppressedAt;

      // Consent recorded before the opt-out is not evidence of a new opt-in.
      const stale = await resubscribeRoute.POST(jsonRequest("/api/contacts/x/resubscribe", "POST", {
        consentSource: "signed form",
        consentedAt: new Date(suppressedAt.getTime() - 60_000).toISOString(),
        evidenceNote: "Old signed consent form",
        confirmation: true,
      }), routeParams(contact.id));
      expect(stale.status).toBe(400);

      // Missing confirmation and short evidence notes are rejected.
      expect((await resubscribeRoute.POST(jsonRequest("/api/contacts/x/resubscribe", "POST", {
        consentSource: "signed form",
        consentedAt: new Date().toISOString(),
        evidenceNote: "Signed consent form on file",
      }), routeParams(contact.id))).status).toBe(400);
      expect((await resubscribeRoute.POST(jsonRequest("/api/contacts/x/resubscribe", "POST", {
        consentSource: "signed form",
        consentedAt: new Date().toISOString(),
        evidenceNote: "short",
        confirmation: true,
      }), routeParams(contact.id))).status).toBe(400);

      // Consent recorded after the opt-out restores eligibility and clears suppression.
      const restored = await resubscribeRoute.POST(jsonRequest("/api/contacts/x/resubscribe", "POST", {
        consentSource: "signed form",
        consentedAt: new Date().toISOString(),
        evidenceNote: "Signed consent form on file",
        confirmation: true,
      }), routeParams(contact.id));
      expect(restored.status).toBe(200);

      const eligible = await readContact(contact.id);
      expect(eligible.contact.optedIn).toBe(true);
      expect(eligible.contact.optInSource).toBe("signed form");
      expect(eligible.contact.unsubscribedAt).toBeNull();

      const remaining = await db.select().from(schema.suppressionList).where(and(
        eq(schema.suppressionList.organizationId, workspace.organizationId),
        eq(schema.suppressionList.phoneE164, contact.phoneE164),
      ));
      expect(remaining).toHaveLength(0);

      const consentEvents = await db.select().from(schema.contactConsentEvents).where(
        eq(schema.contactConsentEvents.contactId, contact.id),
      );
      expect(consentEvents.map((event) => event.eventType).sort()).toEqual(["manual_suppression", "resubscribe"]);

      // Restoring consent for an already-eligible contact is refused.
      expect((await resubscribeRoute.POST(jsonRequest("/api/contacts/x/resubscribe", "POST", {
        consentSource: "signed form",
        consentedAt: new Date().toISOString(),
        evidenceNote: "Signed consent form on file",
        confirmation: true,
      }), routeParams(contact.id))).status).toBe(409);
    } finally {
      await workspace.cleanup();
    }
  });

  test("the eligible and suppressed list filters agree with the stored consent state", async () => {
    const workspace = await createWorkspace();
    workspace.actAs();
    try {
      const eligible = await createContact(nextPhone());
      const suppressed = await createContact(nextPhone());
      await db.update(schema.contacts)
        .set({ optedIn: true, optInSource: "web form", optInAt: new Date() })
        .where(eq(schema.contacts.id, eligible.id));
      await suppressRoute.POST(jsonRequest("/api/contacts/x/suppress", "POST", {}), routeParams(suppressed.id));

      const eligibleList = await contactsRoute.GET(new Request("http://localhost/api/contacts?status=eligible"));
      expect((await eligibleList.json() as { contacts: ContactRow[] }).contacts.map((contact) => contact.id)).toEqual([eligible.id]);

      const suppressedList = await contactsRoute.GET(new Request("http://localhost/api/contacts?status=suppressed"));
      const suppressedPayload = await suppressedList.json() as { contacts: Array<ContactRow & { suppressionReason: string | null }> };
      expect(suppressedPayload.contacts.map((contact) => contact.id)).toEqual([suppressed.id]);
      expect(suppressedPayload.contacts[0]?.suppressionReason).toBe("Manually suppressed from Contacts");

      const notEligible = await contactsRoute.GET(new Request("http://localhost/api/contacts?status=not_eligible"));
      expect((await notEligible.json() as { contacts: ContactRow[] }).contacts.map((contact) => contact.id)).toEqual([suppressed.id]);
    } finally {
      await workspace.cleanup();
    }
  });
});
