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

describe("contact management — permission enforcement", () => {
  test("unauthenticated callers cannot read or mutate contacts", async () => {
    const workspace = await createWorkspace();
    workspace.signOut();
    try {
      const contactId = randomUUID();
      expect((await contactsRoute.GET(new Request("http://localhost/api/contacts"))).status).toBe(401);
      expect((await contactsRoute.POST(jsonRequest("/api/contacts", "POST", { phoneE164: nextPhone() }))).status).toBe(401);
      expect((await contactDetailRoute.GET(new Request("http://localhost/api/contacts/x"), routeParams(contactId))).status).toBe(401);
      expect((await contactDetailRoute.PATCH(jsonRequest("/api/contacts/x", "PATCH", { displayName: "x" }), routeParams(contactId))).status).toBe(401);
      expect((await bulkRoute.POST(jsonRequest("/api/contacts/bulk", "POST", { contactIds: [contactId], action: "suppress" }))).status).toBe(401);
      expect((await mergeRoute.POST(jsonRequest("/api/contacts/merge", "POST", { targetContactId: contactId, sourceContactIds: [randomUUID()] }))).status).toBe(401);
      expect((await suppressRoute.POST(jsonRequest("/api/contacts/x/suppress", "POST", {}), routeParams(contactId))).status).toBe(401);
      expect((await resubscribeRoute.POST(jsonRequest("/api/contacts/x/resubscribe", "POST", {}), routeParams(contactId))).status).toBe(401);
    } finally {
      await workspace.cleanup();
    }
  });

  test("a viewer can read but every contact mutation is forbidden", async () => {
    const ownerWorkspace = await createWorkspace();
    const viewerWorkspace = await createWorkspace("viewer");
    ownerWorkspace.actAs();
    try {
      const contact = await createContact(nextPhone());

      // Point the viewer at the owner's organization so only the role differs.
      authContext.current = {
        session: { user: { id: "viewer", email: "viewer@example.com", name: "Viewer" } },
        workspace: {
          userId: viewerWorkspace.userId,
          organizationId: ownerWorkspace.organizationId,
          organizationName: "Contacts",
          organizationSlug: "contacts",
          role: "viewer",
        },
      };

      const list = await contactsRoute.GET(new Request("http://localhost/api/contacts"));
      expect(list.status).toBe(200);
      expect((await contactDetailRoute.GET(new Request("http://localhost/api/contacts/x"), routeParams(contact.id))).status).toBe(200);

      const mutations: Array<[string, number]> = [
        ["POST /api/contacts", (await contactsRoute.POST(jsonRequest("/api/contacts", "POST", { phoneE164: nextPhone() }))).status],
        ["PATCH /api/contacts/:id", (await contactDetailRoute.PATCH(jsonRequest("/api/contacts/x", "PATCH", { displayName: "x" }), routeParams(contact.id))).status],
        ["POST /api/contacts/bulk", (await bulkRoute.POST(jsonRequest("/api/contacts/bulk", "POST", { contactIds: [contact.id], action: "add_tag", tag: "x" }))).status],
        ["POST /api/contacts/merge", (await mergeRoute.POST(jsonRequest("/api/contacts/merge", "POST", { targetContactId: contact.id, sourceContactIds: [randomUUID()] }))).status],
        ["POST /api/contacts/:id/suppress", (await suppressRoute.POST(jsonRequest("/api/contacts/x/suppress", "POST", {}), routeParams(contact.id))).status],
        ["POST /api/contacts/:id/resubscribe", (await resubscribeRoute.POST(jsonRequest("/api/contacts/x/resubscribe", "POST", {}), routeParams(contact.id))).status],
        ["POST /api/contact-imports/presign", (await importPresignRoute.POST(jsonRequest("/api/contact-imports/presign", "POST", {
          fileName: "customers.csv", sizeBytes: 1_024, defaultCountry: "IQ", optInSource: "consent", confirmedOptIn: true,
        }))).status],
      ];
      for (const [endpoint, status] of mutations) {
        expect(status, `${endpoint} must be forbidden for a viewer`).toBe(403);
      }
    } finally {
      await ownerWorkspace.cleanup();
      await viewerWorkspace.cleanup();
    }
  });

  test("a member may manage contacts but may not restore consent", async () => {
    const workspace = await createWorkspace("member");
    workspace.actAs();
    try {
      const phone = nextPhone();
      expect((await contactsRoute.POST(jsonRequest("/api/contacts", "POST", { phoneE164: phone }))).status).toBe(201);

      const [contact] = await db.select({ id: schema.contacts.id }).from(schema.contacts)
        .where(and(eq(schema.contacts.organizationId, workspace.organizationId), eq(schema.contacts.phoneE164, phone)));
      expect(contact).toBeTruthy();

      expect((await suppressRoute.POST(jsonRequest("/api/contacts/x/suppress", "POST", {}), routeParams(contact!.id))).status).toBe(200);

      const resubscribe = await resubscribeRoute.POST(jsonRequest("/api/contacts/x/resubscribe", "POST", {
        consentSource: "signed form",
        consentedAt: new Date(Date.now() + 1_000).toISOString(),
        evidenceNote: "Signed consent form on file",
        confirmation: true,
      }), routeParams(contact!.id));
      expect(resubscribe.status).toBe(403);
    } finally {
      await workspace.cleanup();
    }
  });
});
