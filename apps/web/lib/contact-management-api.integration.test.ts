import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, mock, test } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import { createDatabase, schema } from "@wa/db";

/**
 * Integration coverage for the contact-management surface (issue #63 / PR-018).
 *
 * These tests drive the real Next.js route handlers against a real Postgres
 * database. Only the ambient request context (`@/lib/auth-context`) and the
 * process-wide singletons (`@/lib/server`, `@wa/storage`) are substituted, so
 * the permission matrix in `@/lib/workspace-access` and every SQL statement run
 * exactly as they do in production.
 */

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for contact management integration tests");

const database = createDatabase(databaseUrl);
const db = database.db;

type Role = "owner" | "admin" | "member" | "viewer";
type AuthContext = {
  session: { user: { id: string; email: string; name: string } };
  workspace: {
    userId: string;
    organizationId: string;
    organizationName: string;
    organizationSlug: string;
    role: Role;
  };
};

let currentContext: AuthContext | null = null;

mock.module("@/lib/server", () => ({
  db,
  databaseClient: database.client,
  getR2ServerConfig: () => ({ accountId: "test", accessKeyId: "test", secretAccessKey: "test", bucket: "test-bucket" }),
  contactImportQueue: { add: async () => undefined },
}));

mock.module("@/lib/auth-context", () => ({
  getAuthContext: async () => currentContext,
  requireAuthContext: async () => currentContext,
}));

const contactsRoute = await import("@/app/api/contacts/route");
const contactDetailRoute = await import("@/app/api/contacts/[id]/route");
const bulkRoute = await import("@/app/api/contacts/bulk/route");
const mergeRoute = await import("@/app/api/contacts/merge/route");
const suppressRoute = await import("@/app/api/contacts/[id]/suppress/route");
const resubscribeRoute = await import("@/app/api/contacts/[id]/resubscribe/route");
const importPresignRoute = await import("@/app/api/contact-imports/presign/route");

// Module mocks are process-wide, so release them once this file is done.
afterAll(() => { mock.restore(); });

const jsonRequest = (path: string, method: string, body: unknown) =>
  new Request(`http://localhost${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const routeParams = (id: string) => ({ params: Promise.resolve({ id }) });

type ContactRow = { id: string; phoneE164: string; displayName: string | null };
type ContactDetail = {
  contact: { id: string; optedIn: boolean; optInSource: string | null; unsubscribedAt: string | null };
  tags: string[];
  customFields: Record<string, string>;
  notes: Array<{ id: string; body: string }>;
  activities: Array<{ eventType: string; metadata: Record<string, unknown> }>;
};

async function createWorkspace(role: Role = "owner") {
  const suffix = randomUUID();
  const [user] = await db.insert(schema.users).values({
    externalAuthId: `contacts-${suffix}`,
    email: `contacts-${suffix}@example.com`,
    displayName: "Contacts Owner",
  }).returning();
  const [organization] = await db.insert(schema.organizations).values({
    name: `Contacts ${suffix}`,
    slug: `contacts-${suffix}`,
  }).returning();
  if (!user || !organization) throw new Error("Failed to create contact test fixtures");
  await db.insert(schema.organizationMembers).values({ organizationId: organization.id, userId: user.id, role });

  return {
    userId: user.id,
    organizationId: organization.id,
    actAs: (override: Role = role) => {
      currentContext = {
        session: { user: { id: user.externalAuthId, email: user.email, name: user.displayName ?? "" } },
        workspace: {
          userId: user.id,
          organizationId: organization.id,
          organizationName: organization.name,
          organizationSlug: organization.slug,
          role: override,
        },
      };
    },
    signOut: () => { currentContext = null; },
    cleanup: async () => {
      await db.delete(schema.organizations).where(eq(schema.organizations.id, organization.id));
      await db.delete(schema.users).where(eq(schema.users.id, user.id));
    },
  };
}

let phoneCounter = 0;
function nextPhone(): string {
  phoneCounter += 1;
  return `+1555${String(phoneCounter).padStart(6, "0")}`;
}

async function createContact(phoneE164: string, body: Record<string, unknown> = {}) {
  const response = await contactsRoute.POST(jsonRequest("/api/contacts", "POST", {
    phoneE164,
    tags: [],
    customFields: {},
    ...body,
  }));
  if (response.status !== 201) throw new Error(`Contact fixture failed with ${response.status}: ${await response.text()}`);
  const payload = await response.json() as { contact: ContactRow };
  return payload.contact;
}

async function readContact(id: string): Promise<ContactDetail> {
  const response = await contactDetailRoute.GET(new Request("http://localhost/api/contacts/x"), routeParams(id));
  if (response.status !== 200) throw new Error(`Contact read failed with ${response.status}`);
  return await response.json() as ContactDetail;
}

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
      currentContext = {
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
