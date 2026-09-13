import { TwoFactorForm } from "@/components/two-factor-form";

export default function TwoFactorPage() {
  return (
    <main className="authPage">
      <section className="authCard">
        <div className="authBrand">
          <div className="brandMark">W</div>
          <div><strong>WhatsApp Campaigns</strong><span>Account security</span></div>
        </div>
        <div className="authHeading">
          <p className="eyebrow">Second factor</p>
          <h1>Verify your sign in</h1>
          <p>Enter the current code from your authenticator app, or use one of your recovery codes.</p>
        </div>
        <TwoFactorForm />
      </section>
    </main>
  );
}
