import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { createDatabase, schema } from "@wa/db";

/**
 * Large-list pagination evidence for issue #63 / PR-018.
 *
 * The route handlers are driven with a real database and the SQL they actually
 * execute is captured through a Drizzle logger, then re-run under
 * `EXPLAIN (ANALYZE, FORMAT JSON)`. Asserting on the captured statement keeps
 * the evidence tied to the production query instead of a copy that can drift.
 */

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for contact pagination performance tests");

const LARGE_LIST_SIZE = 10_000;
const PAGE_SIZE = 100;

const base = createDatabase(databaseUrl);
const captured: Array<{ query: string; params: unknown[] }> = [];
const db = drizzle(base.client, {
  schema,
  logger: { logQuery(query, params) { captured.push({ query, params: [...params] }); } },
});

type AuthContext = {
  session: { user: { id: string; email: string; name: string } };
  workspace: { userId: string; organizationId: string; organizationName: string; organizationSlug: string; role: "owner" };
};

let currentContext: AuthContext | null = null;

mock.module("@/lib/server", () => ({
  db,
  databaseClient: base.client,
  getR2ServerConfig: () => ({ accountId: "test", accessKeyId: "test", secretAccessKey: "test", bucket: "test-bucket" }),
  contactImportQueue: { add: async () => undefined },
}));

mock.module("@/lib/auth-context", () => ({
  getAuthContext: async () => currentContext,
  requireAuthContext: async () => currentContext,
}));

const contactsRoute = await import("@/app/api/contacts/route");

// Module mocks are process-wide, so release them once this file is done.
afterAll(() => { mock.restore(); });

async function createWorkspace() {
  const suffix = randomUUID();
  const [user] = await db.insert(schema.users).values({
    externalAuthId: `pagination-${suffix}`,
    email: `pagination-${suffix}@example.com`,
    displayName: "Pagination Owner",
  }).returning();
  const [organization] = await db.insert(schema.organizations).values({
    name: `Pagination ${suffix}`,
    slug: `pagination-${suffix}`,
  }).returning();
  if (!user || !organization) throw new Error("Failed to create pagination fixtures");

  currentContext = {
    session: { user: { id: user.externalAuthId, email: user.email, name: user.displayName ?? "" } },
    workspace: {
      userId: user.id,
      organizationId: organization.id,
      organizationName: organization.name,
      organizationSlug: organization.slug,
      role: "owner",
    },
  };

  return {
    organizationId: organization.id,
    cleanup: async () => {
      await db.delete(schema.organizations).where(eq(schema.organizations.id, organization.id));
      await db.delete(schema.users).where(eq(schema.users.id, user.id));
    },
  };
}

/** Seeds a representative large list in batched inserts, spread across many pages. */
async function seedLargeList(organizationId: string, size: number) {
  const batchSize = 2_000;
  for (let offset = 0; offset < size; offset += batchSize) {
    const rows = Array.from({ length: Math.min(batchSize, size - offset) }, (_, index) => ({
      organizationId,
      phoneE164: `+1555${String(offset + index).padStart(7, "0")}`,
      displayName: `Contact ${offset + index}`,
      optedIn: false,
    }));
    await db.insert(schema.contacts).values(rows);
  }
  // Representative statistics for a populated tenant, as autovacuum would provide.
  await base.client.unsafe("ANALYZE contacts");
}

type PlanNode = {
  "Node Type": string;
  "Subplan Name"?: string;
  "Relation Name"?: string;
  "Index Name"?: string;
  "Actual Rows"?: number;
  Plans?: PlanNode[];
};

/** Walks the main plan only; correlated subplans (e.g. the tag aggregate) are excluded. */
function flatten(node: PlanNode): PlanNode[] {
  if (node["Subplan Name"]) return [];
  return [node, ...(node.Plans ?? []).flatMap(flatten)];
}

async function explainCapturedListQuery() {
  const statement = captured.find((entry) => entry.query.includes("FROM contacts c") && entry.query.includes("LIMIT"));
  if (!statement) throw new Error("The list query was not captured");

  const explained = await base.client.unsafe(
    `EXPLAIN (ANALYZE, FORMAT JSON) ${statement.query}`,
    statement.params as never[],
  );
  const plan = (explained[0] as unknown as { "QUERY PLAN": Array<{ Plan: PlanNode; "Execution Time": number }> })["QUERY PLAN"][0];
  if (!plan) throw new Error("EXPLAIN returned no plan");
  return { plan: plan.Plan, executionTimeMs: plan["Execution Time"], statement };
}

describe("contact management — large list pagination performance", () => {
  test("a deep keyset page is served by the organization+phone index without scanning the tenant", async () => {
    const workspace = await createWorkspace();
    try {
      await seedLargeList(workspace.organizationId, LARGE_LIST_SIZE);

      // Walk to a deep page, then measure the statement that produced it.
      // The cursor leaves two full pages behind it so the page is not the last.
      const deepCursor = `+1555${String(LARGE_LIST_SIZE - 2 * PAGE_SIZE - 1).padStart(7, "0")}`;
      captured.length = 0;
      const response = await contactsRoute.GET(new Request(
        `http://localhost/api/contacts?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(deepCursor)}`,
      ));
      expect(response.status).toBe(200);
      const payload = await response.json() as { contacts: Array<{ id: string }>; nextCursor: string | null };
      expect(payload.contacts).toHaveLength(PAGE_SIZE);
      expect(payload.nextCursor).not.toBeNull();

      const { plan, executionTimeMs, statement } = await explainCapturedListQuery();
      expect(statement.query).toContain("c.phone_e164 >");
      const nodes = flatten(plan);
      const contactsScan = nodes.find((node) => node["Relation Name"] === "contacts");
      expect(contactsScan, "the plan must scan the contacts relation").toBeTruthy();

      // Keyset pagination must seek, not scan: the outer access to contacts is
      // driven by the organization+phone index, the ordering is satisfied by the
      // index (no sort), and roughly one page of rows is touched rather than the
      // whole tenant list.
      expect(contactsScan!["Node Type"]).toBe("Index Scan");
      expect(contactsScan!["Index Name"]).toBe("contacts_org_phone_uq");
      expect(contactsScan!["Actual Rows"] ?? 0).toBeLessThanOrEqual(PAGE_SIZE + 1);
      expect(nodes.some((node) => node["Node Type"] === "Seq Scan" && node["Relation Name"] === "contacts")).toBe(false);
      expect(nodes.some((node) => node["Node Type"] === "Sort")).toBe(false);
      // Smoke bound only; the plan shape above is the substantive evidence.
      expect(executionTimeMs).toBeLessThan(1_000);
    } finally {
      await workspace.cleanup();
    }
  });

  test("walking every page of a large list stays linear in pages and never repeats a contact", async () => {
    const workspace = await createWorkspace();
    try {
      const size = 1_200;
      await seedLargeList(workspace.organizationId, size);

      const seen = new Set<string>();
      let cursor: string | null = null;
      let pages = 0;
      const startedAt = Date.now();
      do {
        const url = `http://localhost/api/contacts?limit=${PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
        const response = await contactsRoute.GET(new Request(url));
        expect(response.status).toBe(200);
        const payload = await response.json() as { contacts: Array<{ id: string }>; nextCursor: string | null };
        for (const contact of payload.contacts) {
          expect(seen.has(contact.id), "a contact must not appear on two pages").toBe(false);
          seen.add(contact.id);
        }
        cursor = payload.nextCursor;
        pages += 1;
      } while (cursor);

      expect(pages).toBe(Math.ceil(size / PAGE_SIZE));
      expect(seen.size).toBe(size);
      // Guards against an accidental offset-scan regression on a large tenant.
      expect(Date.now() - startedAt).toBeLessThan(5_000);
    } finally {
      await workspace.cleanup();
    }
  });
});
