import { and, eq, sql } from "drizzle-orm";
import { createDatabase, schema } from "@wa/db";

type Database = ReturnType<typeof createDatabase>["db"];

export async function transferWorkspaceOwnershipAtomic(
  database: Database,
  input: {
    organizationId: string;
    actorUserId: string;
    targetMembershipId: string;
  },
) {
  return database.transaction(async (tx) => {
    // Serialize ownership changes for one organization. The role check must occur
    // after the lock is acquired so a concurrent request cannot reuse stale owner
    // authorization after another transfer has already committed.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.organizationId}))`);

    const actor = (
      await tx
        .select({ role: schema.organizationMembers.role })
        .from(schema.organizationMembers)
        .where(and(
          eq(schema.organizationMembers.organizationId, input.organizationId),
          eq(schema.organizationMembers.userId, input.actorUserId),
        ))
        .limit(1)
    )[0];
    if (actor?.role !== "owner") throw new Error("Forbidden");

    const target = (
      await tx
        .select({
          id: schema.organizationMembers.id,
          userId: schema.organizationMembers.userId,
          role: schema.organizationMembers.role,
        })
        .from(schema.organizationMembers)
        .where(and(
          eq(schema.organizationMembers.id, input.targetMembershipId),
          eq(schema.organizationMembers.organizationId, input.organizationId),
        ))
        .limit(1)
    )[0];
    if (!target) throw new Error("Member not found");
    if (target.userId === input.actorUserId) throw new Error("You already own this workspace");

    await tx
      .update(schema.organizationMembers)
      .set({ role: "admin" })
      .where(and(
        eq(schema.organizationMembers.organizationId, input.organizationId),
        eq(schema.organizationMembers.userId, input.actorUserId),
        eq(schema.organizationMembers.role, "owner"),
      ));
    await tx
      .update(schema.organizationMembers)
      .set({ role: "owner" })
      .where(and(
        eq(schema.organizationMembers.id, target.id),
        eq(schema.organizationMembers.organizationId, input.organizationId),
      ));
    await tx.insert(schema.workspaceAuditLogs).values({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "workspace.ownership.transferred",
      targetType: "user",
      targetId: target.userId,
      metadata: { previousRole: target.role },
    });

    return target;
  });
}
