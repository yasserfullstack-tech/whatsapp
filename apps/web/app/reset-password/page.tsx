import { ResetPasswordForm } from "@/components/reset-password-form";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const token = typeof query.token === "string" ? query.token : undefined;
  const invalidToken = query.error === "INVALID_TOKEN";

  return (
    <main className="authPage">
      <section className="authCard">
        <div className="authBrand">
          <div className="brandMark">W</div>
          <div><strong>WhatsApp Campaigns</strong><span>Account security</span></div>
        </div>
        <div className="authHeading">
          <p className="eyebrow">Account recovery</p>
          <h1>Reset password</h1>
          <p>Choose a new password. Resetting it signs out your other active sessions.</p>
        </div>
        <ResetPasswordForm {...(token ? { token } : {})} invalidToken={invalidToken} />
      </section>
    </main>
  );
}
