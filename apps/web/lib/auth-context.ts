import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./server";
import { ensureWorkspace } from "./workspace";

export async function getAuthContext() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;

  const workspace = await ensureWorkspace({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  });

  return { session, workspace };
}

export async function requireAuthContext() {
  const context = await getAuthContext();
  if (!context) redirect("/sign-in");
  return context;
}
