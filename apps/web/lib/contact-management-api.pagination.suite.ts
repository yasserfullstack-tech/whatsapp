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

describe("contact management — keyset pagination", () => {
  test("pagination walks every contact exactly once without overlap", async () => {
    const workspace = await createWorkspace();
    workspace.actAs();
    try {
      const total = 25;
      for (let index = 0; index < total; index += 1) {
        await createContact(nextPhone(), { displayName: `Paged ${index}` });
      }

      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const url = `http://localhost/api/contacts?limit=10${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
        const response = await contactsRoute.GET(new Request(url));
        expect(response.status).toBe(200);
        const payload = await response.json() as {
          contacts: ContactRow[];
          nextCursor: string | null;
          activities: unknown[];
        };
        pages += 1;
        // The broader activity feed is only attached to the first page.
        if (pages === 1) expect(payload.activities.length).toBeGreaterThan(0);
        else expect(payload.activities).toEqual([]);
        seen.push(...payload.contacts.map((contact) => contact.id));
        cursor = payload.nextCursor;
      } while (cursor);

      expect(pages).toBe(3);
      expect(seen).toHaveLength(total);
      expect(new Set(seen).size).toBe(total);
    } finally {
      await workspace.cleanup();
    }
  });

  test("search filtering still paginates on the same keyset", async () => {
    const workspace = await createWorkspace();
    workspace.actAs();
    try {
      await db.insert(schema.contacts).values([
        { organizationId: workspace.organizationId, phoneE164: "+155500000001", displayName: "Match One" },
        { organizationId: workspace.organizationId, phoneE164: "+155500000002", displayName: "Match Two" },
        { organizationId: workspace.organizationId, phoneE164: "+155500000003", displayName: "Other" },
      ]);

      const response = await contactsRoute.GET(new Request("http://localhost/api/contacts?q=Match&limit=10"));
      const payload = await response.json() as { contacts: ContactRow[]; nextCursor: string | null };
      expect(payload.contacts.map((contact) => contact.displayName)).toEqual(["Match One", "Match Two"]);
      expect(payload.nextCursor).toBeNull();

      const escaped = await contactsRoute.GET(new Request("http://localhost/api/contacts?q=%25&limit=10"));
      expect((await escaped.json() as { contacts: ContactRow[] }).contacts).toHaveLength(0);
    } finally {
      await workspace.cleanup();
    }
  });
});
