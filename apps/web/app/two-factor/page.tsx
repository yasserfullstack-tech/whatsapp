import { TwoFactorForm } from "@/components/two-factor-form";
import { getI18n } from "@/lib/i18n/server";
import { productionUiMessages } from "@/lib/i18n/production-ui";

export default async function TwoFactorPage() {
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
          <p className="eyebrow">{copy.twoFactor.eyebrow}</p>
          <h1>{copy.twoFactor.title}</h1>
          <p>{copy.twoFactor.description}</p>
        </div>
        <TwoFactorForm />
      </section>
    </main>
  );
}
