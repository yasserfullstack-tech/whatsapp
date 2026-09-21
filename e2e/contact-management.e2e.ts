import { expect, test } from "@playwright/test";
import { schema } from "../packages/db/src/index";
import {
  createTenant,
  destroyTenant,
  functionalDb,
  functionalSql,
} from "./support/functional-helpers";

function desktopOnly(projectName: string) {
  return projectName !== "desktop-1440";
}

const mutationHeaders = {
  origin: "http://127.0.0.1:3000",
  "sec-fetch-site": "same-origin",
};

type ContactDetail = {
  contact: {
    id: string;
    phoneE164: string;
    displayName: string | null;
    optedIn: boolean;
  };
  tags: string[];
  customFields: Record<string, string>;
  notes: Array<{ body: string }>;
  activities: Array<{ eventType: string }>;
};

test.describe("contact management evidence", () => {
  test.beforeEach(({}, testInfo) =>
    test.skip(desktopOnly(testInfo.project.name), "contact management evidence runs once on desktop Chromium"),
  );

  test("manual create/edit, bulk actions, and merge are persisted and auditable", async () => {
    const tenant = await createTenant("contact-management-lifecycle");
    try {
      const targetResponse = await tenant.api.post("/api/contacts", {
        headers: mutationHeaders,
        data: {
          phoneE164: "+18005550101",
          displayName: "Primary Contact",
          tags: ["primary"],
          customFields: { company: "Acme" },
          note: "Primary creation note",
        },
      });
      expect(targetResponse.status(), await targetResponse.text()).toBe(201);
      const target = (await targetResponse.json()) as { contact: { id: string } };

      const sourceResponse = await tenant.api.post("/api/contacts", {
        headers: mutationHeaders,
        data: {
          phoneE164: "+18005550102",
          displayName: "Duplicate Contact",
          tags: ["source-only"],
          customFields: { company: "Source Co", sourceField: "preserved" },
          note: "Source note that must move to the target",
        },
      });
      expect(sourceResponse.status(), await sourceResponse.text()).toBe(201);
      const source = (await sourceResponse.json()) as { contact: { id: string } };

      const update = await tenant.api.patch(`/api/contacts/${target.contact.id}`, {
        headers: mutationHeaders,
        data: {
          displayName: "Primary Contact Updated",
          tags: ["vip", "priority"],
          customFields: { company: "Acme", tier: "gold" },
          note: "Primary follow-up note",
        },
      });
      expect(update.status(), await update.text()).toBe(200);

      const bulkTag = await tenant.api.post("/api/contacts/bulk", {
        headers: mutationHeaders,
        data: {
          contactIds: [target.contact.id, source.contact.id],
          action: "add_tag",
          tag: "shared",
        },
      });
      expect(bulkTag.status(), await bulkTag.text()).toBe(200);
      expect(await bulkTag.json()).toMatchObject({ affected: 2, action: "add_tag" });

      const merge = await tenant.api.post("/api/contacts/merge", {
        headers: mutationHeaders,
        data: {
          targetContactId: target.contact.id,
          sourceContactIds: [source.contact.id],
          reason: "E2E duplicate review",
        },
      });
      expect(merge.status(), await merge.text()).toBe(200);
      expect(await merge.json()).toMatchObject({
        targetContactId: target.contact.id,
        sourceContactIds: [source.contact.id],
        consentPreservedPerPhone: true,
      });

      const mergedSource = await tenant.api.get(`/api/contacts/${source.contact.id}`);
      expect(mergedSource.status()).toBe(404);

      const detailResponse = await tenant.api.get(`/api/contacts/${target.contact.id}`);
      expect(detailResponse.status(), await detailResponse.text()).toBe(200);
      const detail = (await detailResponse.json()) as ContactDetail;
      expect(detail.contact.displayName).toBe("Primary Contact Updated");
      expect(detail.tags).toEqual(expect.arrayContaining(["vip", "priority", "shared", "source-only"]));
      expect(detail.customFields).toMatchObject({
        company: "Acme",
        tier: "gold",
        sourceField: "preserved",
      });
      expect(detail.notes.map((note) => note.body)).toEqual(
        expect.arrayContaining([
          "Primary creation note",
          "Primary follow-up note",
          "Source note that must move to the target",
        ]),
      );
      expect(detail.activities.map((activity) => activity.eventType)).toEqual(
        expect.arrayContaining(["contact.created", "contact.updated", "contact.bulk_tag_added", "contact.merge_completed"]),
      );

      const mergeAudit = (await functionalSql`
        SELECT reason, source_snapshot, target_snapshot
        FROM contact_merges
        WHERE organization_id = ${tenant.organizationId}::uuid
          AND source_contact_id = ${source.contact.id}::uuid
          AND target_contact_id = ${target.contact.id}::uuid
      `) as unknown as Array<{
        reason: string;
        source_snapshot: { id?: string };
        target_snapshot: { id?: string };
      }>;
      expect(mergeAudit).toHaveLength(1);
      expect(mergeAudit[0]?.reason).toBe("E2E duplicate review");
      expect(mergeAudit[0]?.source_snapshot.id).toBe(source.contact.id);
      expect(mergeAudit[0]?.target_snapshot.id).toBe(target.contact.id);

      const bulkSuppress = await tenant.api.post("/api/contacts/bulk", {
        headers: mutationHeaders,
        data: {
          contactIds: [target.contact.id],
          action: "suppress",
          reason: "E2E bulk suppression proof",
        },
      });
      expect(bulkSuppress.status(), await bulkSuppress.text()).toBe(200);

      const suppressedResponse = await tenant.api.get(`/api/contacts/${target.contact.id}`);
      expect(suppressedResponse.status(), await suppressedResponse.text()).toBe(200);
      const suppressed = (await suppressedResponse.json()) as ContactDetail;
      expect(suppressed.contact.optedIn).toBe(false);
      expect(suppressed.activities.map((activity) => activity.eventType)).toContain("contact.bulk_suppressed");
    } finally {
      await destroyTenant(tenant);
    }
  });

  test("keyset pagination traverses a large contact list with the organization/phone index", async () => {
    const tenant = await createTenant("contact-pagination");
    try {
      const contactCount = 1_205;
      await functionalDb.insert(schema.contacts).values(
        Array.from({ length: contactCount }, (_, index) => ({
          organizationId: tenant.organizationId,
          phoneE164: `+1800${index.toString().padStart(7, "0")}`,
          displayName: `Pagination Contact ${index.toString().padStart(4, "0")}`,
          optedIn: false,
        })),
      );

      const seenIds = new Set<string>();
      let cursor: string | null = null;
      let pages = 0;
      const startedAt = Date.now();

      do {
        const query = new URLSearchParams({ limit: "100" });
        if (cursor) query.set("cursor", cursor);
        const response = await tenant.api.get(`/api/contacts?${query.toString()}`);
        expect(response.status(), await response.text()).toBe(200);
        const body = (await response.json()) as {
          contacts: Array<{ id: string; phoneE164: string }>;
          nextCursor: string | null;
        };

        expect(body.contacts.length).toBeLessThanOrEqual(100);
        const phones = body.contacts.map((contact) => contact.phoneE164);
        expect(phones).toEqual([...phones].sort());
        for (const contact of body.contacts) {
          expect(seenIds.has(contact.id)).toBe(false);
          seenIds.add(contact.id);
        }

        cursor = body.nextCursor;
        pages += 1;
        expect(pages).toBeLessThan(20);
      } while (cursor);

      expect(seenIds.size).toBe(contactCount);
      expect(pages).toBe(13);

      const explainRows = (await functionalSql`
        EXPLAIN (COSTS OFF)
        SELECT c.id, c.phone_e164
        FROM contacts c
        WHERE c.organization_id = ${tenant.organizationId}::uuid
          AND c.phone_e164 > ${"+18000000600"}
        ORDER BY c.phone_e164 ASC
        LIMIT 101
      `) as unknown as Array<Record<string, unknown>>;
      const plan = explainRows
        .map((row) => String(row["QUERY PLAN"] ?? Object.values(row)[0] ?? ""))
        .join("\n");

      expect(plan).toContain("contacts_org_phone_uq");
      console.info(
        `[contact-pagination] traversed ${contactCount} contacts in ${pages} bounded pages in ${Date.now() - startedAt}ms\n${plan}`,
      );
    } finally {
      await destroyTenant(tenant);
    }
  });
});
