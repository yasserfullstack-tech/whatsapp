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

describe("contact management — merge and deduplication", () => {
  test("merging is auditable, moves metadata, preserves per-phone consent and hides the source", async () => {
    const workspace = await createWorkspace();
    workspace.actAs();
    try {
      const target = await createContact(nextPhone(), { displayName: "Acme Ltd", tags: ["target"] });
      const source = await createContact(nextPhone(), {
        displayName: "ACME LTD",
        tags: ["source"],
        customFields: { region: "eu" },
        note: "Source note",
      });
      await db.insert(schema.suppressionList).values({
        organizationId: workspace.organizationId,
        phoneE164: source.phoneE164,
        reason: "marketing_opt_out",
        source: "webhook",
      });

      const response = await mergeRoute.POST(jsonRequest("/api/contacts/merge", "POST", {
        targetContactId: target.id,
        sourceContactIds: [source.id],
        reason: "Duplicate display-name review",
      }));
      expect(response.status).toBe(200);
      const result = await response.json() as { consentPreservedPerPhone: boolean; sourceContactIds: string[] };
      expect(result.consentPreservedPerPhone).toBe(true);
      expect(result.sourceContactIds).toEqual([source.id]);

      const audits = await db.execute(sql`
        SELECT target_contact_id, actor_user_id, reason, source_snapshot, target_snapshot
        FROM contact_merges
        WHERE organization_id = ${workspace.organizationId}::uuid AND source_contact_id = ${source.id}::uuid
      `);
      expect(audits).toHaveLength(1);
      const audit = audits[0] as {
        target_contact_id: string;
        actor_user_id: string | null;
        reason: string | null;
        source_snapshot: { phoneE164: string };
        target_snapshot: { phoneE164: string };
      };
      expect(audit.target_contact_id).toBe(target.id);
      expect(audit.actor_user_id).toBe(workspace.userId);
      expect(audit.reason).toBe("Duplicate display-name review");
      expect(audit.source_snapshot.phoneE164).toBe(source.phoneE164);
      expect(audit.target_snapshot.phoneE164).toBe(target.phoneE164);

      const targetDetail = await readContact(target.id);
      expect(targetDetail.tags).toEqual(["source", "target"]);
      expect(targetDetail.customFields).toEqual({ region: "eu" });
      expect(targetDetail.notes.map((note) => note.body)).toEqual(["Source note"]);
      expect(targetDetail.activities.map((event) => event.eventType)).toContain("contact.merge_completed");

      // The merged source is no longer an active contact.
      const sourceRead = await contactDetailRoute.GET(new Request("http://localhost/api/contacts/x"), routeParams(source.id));
      expect(sourceRead.status).toBe(404);
      const list = await contactsRoute.GET(new Request("http://localhost/api/contacts?limit=100"));
      const listPayload = await list.json() as { contacts: ContactRow[] };
      expect(listPayload.contacts.map((contact) => contact.id)).toEqual([target.id]);

      // Consent and suppression stay attached to the source phone number.
      const targetSuppressions = await db.select().from(schema.suppressionList).where(and(
        eq(schema.suppressionList.organizationId, workspace.organizationId),
        eq(schema.suppressionList.phoneE164, target.phoneE164),
      ));
      expect(targetSuppressions).toHaveLength(0);
      const sourceSuppressions = await db.select().from(schema.suppressionList).where(and(
        eq(schema.suppressionList.organizationId, workspace.organizationId),
        eq(schema.suppressionList.phoneE164, source.phoneE164),
      ));
      expect(sourceSuppressions).toHaveLength(1);
    } finally {
      await workspace.cleanup();
    }
  });

  test("merge refuses a target used as a source and refuses already-merged sources", async () => {
    const workspace = await createWorkspace();
    workspace.actAs();
    try {
      const target = await createContact(nextPhone());
      const source = await createContact(nextPhone());

      expect((await mergeRoute.POST(jsonRequest("/api/contacts/merge", "POST", {
        targetContactId: target.id,
        sourceContactIds: [target.id],
      }))).status).toBe(400);

      expect((await mergeRoute.POST(jsonRequest("/api/contacts/merge", "POST", {
        targetContactId: target.id,
        sourceContactIds: [source.id],
      }))).status).toBe(200);

      const replay = await mergeRoute.POST(jsonRequest("/api/contacts/merge", "POST", {
        targetContactId: target.id,
        sourceContactIds: [source.id],
      }));
      expect(replay.status).toBe(409);

      const otherTarget = await createContact(nextPhone());
      expect((await mergeRoute.POST(jsonRequest("/api/contacts/merge", "POST", {
        targetContactId: otherTarget.id,
        sourceContactIds: [source.id],
      }))).status).toBe(409);
    } finally {
      await workspace.cleanup();
    }
  });

  test("duplicate discovery groups normalized display names and excludes merged sources", async () => {
    const workspace = await createWorkspace();
    workspace.actAs();
    try {
      const first = await createContact(nextPhone(), { displayName: "Acme Ltd" });
      const second = await createContact(nextPhone(), { displayName: "acme ltd" });
      const unique = await createContact(nextPhone(), { displayName: "Solo Trader" });
      await createContact(nextPhone(), { displayName: null });

      const response = await contactsRoute.GET(new Request("http://localhost/api/contacts?duplicates=1"));
      expect(response.status).toBe(200);
      const { groups } = await response.json() as { groups: Array<{ duplicate_key: string; contacts: ContactRow[] }> };
      expect(groups).toHaveLength(1);
      expect(groups[0]!.duplicate_key).toBe("acme ltd");
      expect(groups[0]!.contacts.map((contact) => contact.id).sort()).toEqual([first.id, second.id].sort());
      expect(groups[0]!.contacts.some((contact) => contact.id === unique.id)).toBe(false);

      expect((await mergeRoute.POST(jsonRequest("/api/contacts/merge", "POST", {
        targetContactId: first.id,
        sourceContactIds: [second.id],
      }))).status).toBe(200);

      const afterMerge = await contactsRoute.GET(new Request("http://localhost/api/contacts?duplicates=1"));
      expect((await afterMerge.json() as { groups: unknown[] }).groups).toHaveLength(0);
    } finally {
      await workspace.cleanup();
    }
  });
});
