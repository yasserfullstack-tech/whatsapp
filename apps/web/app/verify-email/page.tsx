import { VerifyEmailForm } from "@/components/verify-email-form";
import { getI18n } from "@/lib/i18n/server";
import { productionUiMessages } from "@/lib/i18n/production-ui";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const dynamic = "force-dynamic";

export default async function VerifyEmailPage({ searchParams }: { searchParams: SearchParams }) {
  const [{ locale }, query] = await Promise.all([getI18n(), searchParams]);
  const copy = productionUiMessages[locale];
  const email = typeof query.email === "string" ? query.email : "";

  return (
    <main className="authPage">
      <section className="authCard">
        <div className="authBrand">
          <div className="brandMark">W</div>
          <div><strong>WhatsApp Campaigns</strong><span>{copy.brandSubtitle}</span></div>
        </div>
        <div className="authHeading">
          <p className="eyebrow">{copy.verifyEmail.eyebrow}</p>
          <h1>{copy.verifyEmail.title}</h1>
          <p>{copy.verifyEmail.description}</p>
        </div>
        <VerifyEmailForm initialEmail={email} />
      </section>
    </main>
  );
}
