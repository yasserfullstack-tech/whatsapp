import { ResetPasswordForm } from "@/components/reset-password-form";
import { getI18n } from "@/lib/i18n/server";
import { productionUiMessages } from "@/lib/i18n/production-ui";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const [{ locale }, query] = await Promise.all([getI18n(), searchParams]);
  const copy = productionUiMessages[locale];
  const token = typeof query.token === "string" ? query.token : undefined;
  const invalidToken = query.error === "INVALID_TOKEN";

  return (
    <main className="authPage">
      <section className="authCard">
        <div className="authBrand">
          <div className="brandMark">W</div>
          <div><strong>WhatsApp Campaigns</strong><span>{copy.brandSubtitle}</span></div>
        </div>
        <div className="authHeading">
          <p className="eyebrow">{copy.resetPassword.eyebrow}</p>
          <h1>{copy.resetPassword.title}</h1>
          <p>{copy.resetPassword.description}</p>
        </div>
        <ResetPasswordForm {...(token ? { token } : {})} invalidToken={invalidToken} />
      </section>
    </main>
  );
}
