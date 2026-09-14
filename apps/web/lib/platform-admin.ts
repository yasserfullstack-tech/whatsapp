import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { schema } from "@wa/db";
import { auth, db } from "./server";

export type PlatformAdminContext = {
  authUserId: string;
  email: string;
  name: string;
  source: "database" | "bootstrap";
};

function bootstrapAdminUserIds(): Set<string> {
  return new Set(
    (process.env.PLATFORM_ADMIN_USER_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function bootstrapAdminEmails(): Set<string> {
  return new Set(
    (process.env.PLATFORM_ADMIN_EMAILS ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function requirePlatformAdmin(): Promise<PlatformAdminContext> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const userControl = (
    await db
      .select({ disabled: schema.platformUserControls.disabled })
      .from(schema.users)
      .innerJoin(schema.platformUserControls, eq(schema.platformUserControls.userId, schema.users.id))
      .where(eq(schema.users.externalAuthId, session.user.id))
      .limit(1)
  )[0];
  if (userControl?.disabled) redirect("/account-disabled");

  const existing = (
    await db
      .select({ revokedAt: schema.platformAdminGrants.revokedAt })
      .from(schema.platformAdminGrants)
      .where(eq(schema.platformAdminGrants.authUserId, session.user.id))
      .limit(1)
  )[0];

  if (existing && !existing.revokedAt) {
    return {
      authUserId: session.user.id,
      email: session.user.email,
      name: session.user.name,
      source: "database",
    };
  }

  const bootstrappedByUserId = bootstrapAdminUserIds().has(session.user.id);
  const bootstrappedByVerifiedEmail = session.user.emailVerified && bootstrapAdminEmails().has(session.user.email.toLowerCase());
  if (existing?.revokedAt || (!bootstrappedByUserId && !bootstrappedByVerifiedEmail)) {
    redirect("/dashboard");
  }

  await db
    .insert(schema.platformAdminGrants)
    .values({ authUserId: session.user.id, source: bootstrappedByUserId ? "bootstrap-user-id" : "bootstrap-verified-email" })
    .onConflictDoNothing({ target: schema.platformAdminGrants.authUserId });

  return {
    authUserId: session.user.id,
    email: session.user.email,
    name: session.user.name,
    source: "bootstrap",
  };
}
