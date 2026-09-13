import { requireAuthContext } from "@/lib/auth-context";
import { acceptWorkspaceInvitationAction } from "@/lib/workspace-actions";

type PageProps = { params: Promise<{ token: string }> };

export default async function InvitationPage({ params }: PageProps) {
  await requireAuthContext();
  const { token } = await params;

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">Workspace invitation</p>
        <h1>Join workspace</h1>
        <p className="subtitle">Accept this invitation using the same email address that received it.</p>
        <form action={acceptWorkspaceInvitationAction}>
          <input type="hidden" name="token" value={token} />
          <button className="primary" type="submit">Accept invitation</button>
        </form>
      </section>
    </main>
  );
}
