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

describe("contact management — tags, notes, activity history and import mapping", () => {
  test("contact detail exposes tags, custom fields, notes and broader activity history", async () => {
    const workspace = await createWorkspace();
    workspace.actAs();
    try {
      const contact = await createContact(nextPhone(), { tags: ["alpha"], customFields: { region: "eu" } });
      await contactDetailRoute.PATCH(jsonRequest("/api/contacts/x", "PATCH", { note: "Second note" }), routeParams(contact.id));

      const detail = await readContact(contact.id);
      expect(detail.tags).toEqual(["alpha"]);
      expect(detail.customFields).toEqual({ region: "eu" });
      expect(detail.notes.map((note) => note.body)).toEqual(["Second note"]);
      expect(detail.activities.map((event) => event.eventType)).toEqual(["contact.updated", "contact.created"]);
    } finally {
      await workspace.cleanup();
    }
  });

  test("import mapping is validated, normalized and persisted for the worker to consume", async () => {
    const workspace = await createWorkspace();
    workspace.actAs();
    try {
      const response = await importPresignRoute.POST(jsonRequest("/api/contact-imports/presign", "POST", {
        fileName: "customers.csv",
        sizeBytes: 1_024,
        defaultCountry: "iq",
        optInSource: "customer database consent",
        listName: "Spring launch",
        confirmedOptIn: true,
        mapping: {
          phoneColumn: " Phone Number ",
          displayNameColumn: "Full Name",
          customFields: { email: "Email Address" },
        },
      }));
      expect(response.status).toBe(200);
      const { importId } = await response.json() as { importId: string };

      const rows = await db.execute(sql`
        SELECT phone_column, display_name_column, custom_fields
        FROM contact_import_mappings
        WHERE import_id = ${importId}::uuid AND organization_id = ${workspace.organizationId}::uuid
      `);
      expect(rows).toHaveLength(1);
      const mapping = rows[0] as { phone_column: string; display_name_column: string; custom_fields: Record<string, string> };
      expect(mapping.phone_column).toBe("phone_number");
      expect(mapping.display_name_column).toBe("full_name");
      expect(mapping.custom_fields).toEqual({ email: "email_address" });
    } finally {
      await workspace.cleanup();
    }
  });

  test("import mapping rejects non-CSV uploads, invalid field keys and oversized mappings", async () => {
    const workspace = await createWorkspace();
    workspace.actAs();
    try {
      const base = {
        sizeBytes: 1_024,
        defaultCountry: "IQ",
        optInSource: "customer database consent",
        confirmedOptIn: true,
      };
      expect((await importPresignRoute.POST(jsonRequest("/api/contact-imports/presign", "POST", {
        ...base, fileName: "customers.txt",
      }))).status).toBe(400);

      expect((await importPresignRoute.POST(jsonRequest("/api/contact-imports/presign", "POST", {
        ...base, fileName: "customers.csv", mapping: { phoneColumn: "phone", customFields: { "1bad": "col" } },
      }))).status).toBe(400);

      const tooMany = Object.fromEntries(Array.from({ length: 11 }, (_, index) => [`field${index}`, `col${index}`]));
      expect((await importPresignRoute.POST(jsonRequest("/api/contact-imports/presign", "POST", {
        ...base, fileName: "customers.csv", mapping: { phoneColumn: "phone", customFields: tooMany },
      }))).status).toBe(400);

      expect((await importPresignRoute.POST(jsonRequest("/api/contact-imports/presign", "POST", {
        ...base, fileName: "customers.csv", confirmedOptIn: false,
      }))).status).toBe(400);
    } finally {
      await workspace.cleanup();
    }
  });
});
