import { requireAuthContext } from "@/lib/auth-context";
import { InvitationAcceptForm } from "@/components/invitation-accept-form";
import { getI18n } from "@/lib/i18n/server";
import { productionUiMessages } from "@/lib/i18n/production-ui";

type PageProps = { params: Promise<{ token: string }> };

export default async function InvitationPage({ params }: PageProps) {
  const [, { token }, { locale }] = await Promise.all([
    requireAuthContext(),
    params,
    getI18n(),
  ]);
  const copy = productionUiMessages[locale].invitation;

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">{copy.eyebrow}</p>
        <h1>{copy.title}</h1>
        <p className="subtitle">{copy.description}</p>
        <InvitationAcceptForm token={token} label={copy.accept} />
      </section>
    </main>
  );
}
