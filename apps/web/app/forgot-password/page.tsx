import { ForgotPasswordForm } from "@/components/forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <main className="authPage">
      <section className="authCard">
        <div className="authBrand">
          <div className="brandMark">W</div>
          <div><strong>WhatsApp Campaigns</strong><span>Account security</span></div>
        </div>
        <div className="authHeading">
          <p className="eyebrow">Account recovery</p>
          <h1>Forgot password</h1>
          <p>Enter your account email and we will send a time-limited reset link.</p>
        </div>
        <ForgotPasswordForm />
      </section>
    </main>
  );
}
