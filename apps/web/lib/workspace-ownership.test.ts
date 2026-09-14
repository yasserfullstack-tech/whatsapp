import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { asc, eq } from "drizzle-orm";
import { createDatabase, schema } from "@wa/db";
import { transferWorkspaceOwnershipAtomic } from "./workspace-ownership";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for workspace ownership tests");

describe("workspace ownership transfer", () => {
  test("concurrent transfers cannot create multiple workspace owners", async () => {
    const database = createDatabase(databaseUrl);
    const db = database.db;
    const suffix = randomUUID();
    const [organization] = await db.insert(schema.organizations).values({
      name: `Ownership race ${suffix}`,
      slug: `ownership-race-${suffix}`,
    }).returning({ id: schema.organizations.id });
    if (!organization) throw new Error("Could not create organization fixture");

    const users = await db.insert(schema.users).values([
      { externalAuthId: `owner-${suffix}`, email: `owner-${suffix}@example.test` },
      { externalAuthId: `candidate-a-${suffix}`, email: `candidate-a-${suffix}@example.test` },
      { externalAuthId: `candidate-b-${suffix}`, email: `candidate-b-${suffix}@example.test` },
    ]).returning({ id: schema.users.id });
    const [owner, candidateA, candidateB] = users;
    if (!owner || !candidateA || !candidateB) throw new Error("Could not create user fixtures");

    const memberships = await db.insert(schema.organizationMembers).values([
      { organizationId: organization.id, userId: owner.id, role: "owner" },
      { organizationId: organization.id, userId: candidateA.id, role: "member" },
      { organizationId: organization.id, userId: candidateB.id, role: "member" },
    ]).returning({ id: schema.organizationMembers.id, userId: schema.organizationMembers.userId });
    const targetA = memberships.find((membership) => membership.userId === candidateA.id);
    const targetB = memberships.find((membership) => membership.userId === candidateB.id);
    if (!targetA || !targetB) throw new Error("Could not create membership fixtures");

    try {
      const attempts = await Promise.allSettled([
        transferWorkspaceOwnershipAtomic(db, {
          organizationId: organization.id,
          actorUserId: owner.id,
          targetMembershipId: targetA.id,
        }),
        transferWorkspaceOwnershipAtomic(db, {
          organizationId: organization.id,
          actorUserId: owner.id,
          targetMembershipId: targetB.id,
        }),
      ]);

      expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(attempts.filter((result) => result.status === "rejected")).toHaveLength(1);

      const roles = await db.select({ userId: schema.organizationMembers.userId, role: schema.organizationMembers.role })
        .from(schema.organizationMembers)
        .where(eq(schema.organizationMembers.organizationId, organization.id))
        .orderBy(asc(schema.organizationMembers.createdAt));
      expect(roles.filter((membership) => membership.role === "owner")).toHaveLength(1);
      expect(roles.find((membership) => membership.userId === owner.id)?.role).toBe("admin");
    } finally {
      await db.delete(schema.organizations).where(eq(schema.organizations.id, organization.id));
      await db.delete(schema.users).where(eq(schema.users.externalAuthId, `owner-${suffix}`));
      await db.delete(schema.users).where(eq(schema.users.externalAuthId, `candidate-a-${suffix}`));
      await db.delete(schema.users).where(eq(schema.users.externalAuthId, `candidate-b-${suffix}`));
      await database.client.end({ timeout: 5 });
    }
  });
});
