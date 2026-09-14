import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { getI18n } from "@/lib/i18n/server";
import { productionUiMessages } from "@/lib/i18n/production-ui";

export default async function ForgotPasswordPage() {
  const { locale } = await getI18n();
  const copy = productionUiMessages[locale];
  return (
    <main className="authPage">
      <section className="authCard">
        <div className="authBrand">
          <div className="brandMark">W</div>
          <div><strong>WhatsApp Campaigns</strong><span>{copy.brandSubtitle}</span></div>
        </div>
        <div className="authHeading">
          <p className="eyebrow">{copy.forgotPassword.eyebrow}</p>
          <h1>{copy.forgotPassword.title}</h1>
          <p>{copy.forgotPassword.description}</p>
        </div>
        <ForgotPasswordForm />
      </section>
    </main>
  );
}
