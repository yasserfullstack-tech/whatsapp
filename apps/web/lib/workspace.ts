import { eq } from "drizzle-orm";
import { schema } from "@wa/db";
import { db } from "./server";

type AuthUser = {
  id: string;
  email: string;
  name: string;
};

export type WorkspaceContext = {
  userId: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: "owner" | "admin" | "member" | "viewer";
};

function slugPart(input: string): string {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
  return normalized || "workspace";
}

async function findWorkspace(externalAuthId: string): Promise<WorkspaceContext | null> {
  const rows = await db
    .select({
      userId: schema.users.id,
      organizationId: schema.organizations.id,
      organizationName: schema.organizations.name,
      organizationSlug: schema.organizations.slug,
      role: schema.organizationMembers.role,
    })
    .from(schema.users)
    .innerJoin(schema.organizationMembers, eq(schema.organizationMembers.userId, schema.users.id))
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.organizationMembers.organizationId))
    .where(eq(schema.users.externalAuthId, externalAuthId))
    .limit(1);

  return rows[0] ?? null;
}

export async function ensureWorkspace(user: AuthUser): Promise<WorkspaceContext> {
  const existing = await findWorkspace(user.id);
  if (existing) return existing;

  return db.transaction(async (tx) => {
    let appUser = (
      await tx.select().from(schema.users).where(eq(schema.users.externalAuthId, user.id)).limit(1)
    )[0];

    if (!appUser) {
      const inserted = await tx
        .insert(schema.users)
        .values({
          externalAuthId: user.id,
          email: user.email,
          displayName: user.name,
        })
        .onConflictDoNothing({ target: schema.users.externalAuthId })
        .returning();

      appUser = inserted[0] ?? (
        await tx.select().from(schema.users).where(eq(schema.users.externalAuthId, user.id)).limit(1)
      )[0];
    }

    if (!appUser) throw new Error("Could not create application user");

    const existingMembership = (
      await tx
        .select({
          organizationId: schema.organizations.id,
          organizationName: schema.organizations.name,
          organizationSlug: schema.organizations.slug,
          role: schema.organizationMembers.role,
        })
        .from(schema.organizationMembers)
        .innerJoin(schema.organizations, eq(schema.organizations.id, schema.organizationMembers.organizationId))
        .where(eq(schema.organizationMembers.userId, appUser.id))
        .limit(1)
    )[0];

    if (existingMembership) {
      return { userId: appUser.id, ...existingMembership };
    }

    const baseName = user.name.trim() || user.email.split("@")[0] || "My";
    const organizationName = `${baseName}'s Workspace`;
    const suffix = crypto.randomUUID().slice(0, 8);
    const organization = (
      await tx
        .insert(schema.organizations)
        .values({
          name: organizationName,
          slug: `${slugPart(baseName)}-${suffix}`,
        })
        .returning()
    )[0];

    if (!organization) throw new Error("Could not create workspace");

    await tx.insert(schema.organizationMembers).values({
      organizationId: organization.id,
      userId: appUser.id,
      role: "owner",
    });

    return {
      userId: appUser.id,
      organizationId: organization.id,
      organizationName: organization.name,
      organizationSlug: organization.slug,
      role: "owner",
    };
  });
}
