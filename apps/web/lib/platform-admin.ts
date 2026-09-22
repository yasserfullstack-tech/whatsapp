import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { schema } from "@wa/db";
import { hasRecentAuthentication } from "./recent-auth";
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


export async function requirePlatformAdminStepUp(): Promise<PlatformAdminContext> {
  const actor = await requirePlatformAdmin();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.id !== actor.authUserId) redirect("/sign-in");

  const [stepUp] = await db
    .select({
      twoFactorEnabled: schema.authUser.twoFactorEnabled,
      sessionCreatedAt: schema.authSession.createdAt,
    })
    .from(schema.authSession)
    .innerJoin(schema.authUser, eq(schema.authUser.id, schema.authSession.userId))
    .where(and(
      eq(schema.authSession.id, session.session.id),
      eq(schema.authSession.userId, actor.authUserId),
    ))
    .limit(1);

  if (!stepUp?.twoFactorEnabled) {
    throw new Error("Platform administrator mutations require multi-factor authentication");
  }
  if (!hasRecentAuthentication({ createdAt: stepUp.sessionCreatedAt })) {
    throw new Error("Recent authentication required before performing platform administrator mutations");
  }

  return actor;
}


export async function requirePlatformAdminMutation(): Promise<PlatformAdminContext> {
  return requirePlatformAdminStepUp();
}
