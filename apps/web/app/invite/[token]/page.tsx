import { requireAuthContext } from "@/lib/auth-context";
import { getI18n } from "@/lib/i18n/server";
import { productionUiMessages } from "@/lib/i18n/production-ui";
import { acceptWorkspaceInvitationAction } from "@/lib/workspace-actions";

type PageProps = { params: Promise<{ token: string }> };

export default async function InvitationPage({ params }: PageProps) {
  const [, { token }, { locale }] = await Promise.all([requireAuthContext(), params, getI18n()]);
  const copy = productionUiMessages[locale].invitation;

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">{copy.eyebrow}</p>
        <h1>{copy.title}</h1>
        <p className="subtitle">{copy.description}</p>
        <form action={acceptWorkspaceInvitationAction}>
          <input type="hidden" name="token" value={token} />
          <button className="primary" type="submit">{copy.accept}</button>
        </form>
      </section>
    </main>
  );
}
