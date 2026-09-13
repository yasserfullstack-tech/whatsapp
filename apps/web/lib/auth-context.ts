import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { schema } from "@wa/db";
import { auth, db } from "./server";
import { ensureWorkspace } from "./workspace";

export async function getAuthContext() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;

  const userControl = (
    await db
      .select({ disabled: schema.platformUserControls.disabled })
      .from(schema.users)
      .innerJoin(schema.platformUserControls, eq(schema.platformUserControls.userId, schema.users.id))
      .where(eq(schema.users.externalAuthId, session.user.id))
      .limit(1)
  )[0];
  if (userControl?.disabled) redirect("/account-disabled");

  const workspace = await ensureWorkspace({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  });

  const organizationControl = (
    await db
      .select({ status: schema.organizationAdminSettings.status })
      .from(schema.organizationAdminSettings)
      .where(eq(schema.organizationAdminSettings.organizationId, workspace.organizationId))
      .limit(1)
  )[0];
  if (organizationControl?.status === "suspended") redirect("/workspace-suspended");

  return { session, workspace };
}

export async function requireAuthContext() {
  const context = await getAuthContext();
  if (!context) redirect("/sign-in");
  return context;
}
