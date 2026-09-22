import { randomUUID } from "node:crypto";
import { afterAll, mock } from "bun:test";
import { eq } from "drizzle-orm";
import { createDatabase, schema } from "@wa/db";

/**
 * Shared integration fixture for the contact-management API suites.
 *
 * The imported suite modules all run under the single
 * contact-management-api.integration.test.ts entry point, so these process-wide
 * mocks and route imports are initialized exactly once.
 */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for contact management integration tests");

const database = createDatabase(databaseUrl);
export const db = database.db;
export { randomUUID, schema };

export type Role = "owner" | "admin" | "member" | "viewer";
export type AuthContext = {
  session: { user: { id: string; email: string; name: string } };
  workspace: {
    userId: string;
    organizationId: string;
    organizationName: string;
    organizationSlug: string;
    role: Role;
  };
};

export const authContext: { current: AuthContext | null } = { current: null };

mock.module("@/lib/server", () => ({
  db,
  databaseClient: database.client,
  getR2ServerConfig: () => ({ accountId: "test", accessKeyId: "test", secretAccessKey: "test", bucket: "test-bucket" }),
  contactImportQueue: { add: async () => undefined },
}));

mock.module("@/lib/auth-context", () => ({
  getAuthContext: async () => authContext.current,
  requireAuthContext: async () => authContext.current,
}));

export const contactsRoute = await import("@/app/api/contacts/route");
export const contactDetailRoute = await import("@/app/api/contacts/[id]/route");
export const bulkRoute = await import("@/app/api/contacts/bulk/route");
export const mergeRoute = await import("@/app/api/contacts/merge/route");
export const suppressRoute = await import("@/app/api/contacts/[id]/suppress/route");
export const resubscribeRoute = await import("@/app/api/contacts/[id]/resubscribe/route");
export const importPresignRoute = await import("@/app/api/contact-imports/presign/route");

afterAll(() => { mock.restore(); });

export const jsonRequest = (path: string, method: string, body: unknown) =>
  new Request(`http://localhost${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export const routeParams = (id: string) => ({ params: Promise.resolve({ id }) });

export type ContactRow = { id: string; phoneE164: string; displayName: string | null };
export type ContactDetail = {
  contact: { id: string; optedIn: boolean; optInSource: string | null; unsubscribedAt: string | null };
  tags: string[];
  customFields: Record<string, string>;
  notes: Array<{ id: string; body: string }>;
  activities: Array<{ eventType: string; metadata: Record<string, unknown> }>;
};

export async function createWorkspace(role: Role = "owner") {
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
      authContext.current = {
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
    signOut: () => { authContext.current = null; },
    cleanup: async () => {
      await db.delete(schema.organizations).where(eq(schema.organizations.id, organization.id));
      await db.delete(schema.users).where(eq(schema.users.id, user.id));
    },
  };
}

let phoneCounter = 0;
export function nextPhone(): string {
  phoneCounter += 1;
  return `+1555${String(phoneCounter).padStart(6, "0")}`;
}

export async function createContact(phoneE164: string, body: Record<string, unknown> = {}) {
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

export async function readContact(id: string): Promise<ContactDetail> {
  const response = await contactDetailRoute.GET(new Request("http://localhost/api/contacts/x"), routeParams(id));
  if (response.status !== 200) throw new Error(`Contact read failed with ${response.status}`);
  return await response.json() as ContactDetail;
}
