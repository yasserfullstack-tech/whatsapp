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

describe("contact management — manual create and edit", () => {
  test("manual creation persists normalized metadata and starts with marketing consent off", async () => {
    const workspace = await createWorkspace();
    workspace.actAs();
    try {
      const response = await contactsRoute.POST(jsonRequest("/api/contacts", "POST", {
        phoneE164: nextPhone(),
        displayName: "  Ada Lovelace  ",
        tags: ["vip", "vip", " customer "],
        customFields: { company: " Acme ", empty: "   " },
        note: "Met at the trade show",
      }));
      expect(response.status).toBe(201);
      const created = (await response.json() as { contact: ContactRow }).contact;

      const detail = await readContact(created.id);
      expect(detail.contact.optedIn).toBe(false);
      expect(detail.contact.optInSource).toBeNull();
      expect(detail.contact.unsubscribedAt).toBeNull();
      expect(detail.tags).toEqual(["customer", "vip"]);
      expect(detail.customFields).toEqual({ company: "Acme" });
      expect(detail.notes.map((note) => note.body)).toEqual(["Met at the trade show"]);
      expect(detail.activities.some((event) => event.eventType === "contact.created")).toBe(true);
    } finally {
      await workspace.cleanup();
    }
  });

  test("manual creation rejects non-E.164 phones and duplicate identities", async () => {
    const workspace = await createWorkspace();
    workspace.actAs();
    try {
      const invalid = await contactsRoute.POST(jsonRequest("/api/contacts", "POST", { phoneE164: "07701234567" }));
      expect(invalid.status).toBe(400);

      const phone = nextPhone();
      expect((await contactsRoute.POST(jsonRequest("/api/contacts", "POST", { phoneE164: phone }))).status).toBe(201);
      expect((await contactsRoute.POST(jsonRequest("/api/contacts", "POST", { phoneE164: phone }))).status).toBe(409);
    } finally {
      await workspace.cleanup();
    }
  });

  test("editing replaces tags and custom fields and records what changed", async () => {
    const workspace = await createWorkspace();
    workspace.actAs();
    try {
      const contact = await createContact(nextPhone(), {
        tags: ["stale"],
        customFields: { company: "Old Co" },
      });

      const empty = await contactDetailRoute.PATCH(jsonRequest("/api/contacts/x", "PATCH", {}), routeParams(contact.id));
      expect(empty.status).toBe(400);

      const response = await contactDetailRoute.PATCH(jsonRequest("/api/contacts/x", "PATCH", {
        displayName: "Grace Hopper",
        tags: ["renewed", "renewed"],
        customFields: { company: "New Co", tier: "gold" },
        note: "Upgraded plan",
      }), routeParams(contact.id));
      expect(response.status).toBe(200);
      const result = await response.json() as { changed: string[] };
      expect([...result.changed].sort()).toEqual(["customFields", "displayName", "note", "tags"]);

      const detail = await readContact(contact.id);
      expect(detail.tags).toEqual(["renewed"]);
      expect(detail.customFields).toEqual({ company: "New Co", tier: "gold" });
      expect(detail.notes.map((note) => note.body)).toEqual(["Upgraded plan"]);
      const updateEvent = detail.activities.find((event) => event.eventType === "contact.updated");
      expect(updateEvent).toBeTruthy();
      expect([...(updateEvent!.metadata.changed as string[])].sort()).toEqual(["customFields", "displayName", "note", "tags"]);
    } finally {
      await workspace.cleanup();
    }
  });

  test("editing cannot rewrite the phone identity, and merged sources are not editable", async () => {
    const workspace = await createWorkspace();
    workspace.actAs();
    try {
      const contact = await createContact(nextPhone());
      const identityRewrite = await contactDetailRoute.PATCH(
        jsonRequest("/api/contacts/x", "PATCH", { phoneE164: nextPhone() }),
        routeParams(contact.id),
      );
      expect(identityRewrite.status).toBe(400);

      const [phoneRow] = await db.select({ phoneE164: schema.contacts.phoneE164 })
        .from(schema.contacts).where(eq(schema.contacts.id, contact.id));
      expect(phoneRow?.phoneE164).toBe(contact.phoneE164);
    } finally {
      await workspace.cleanup();
    }
  });
});
