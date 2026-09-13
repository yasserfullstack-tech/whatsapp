import { VerifyEmailForm } from "@/components/verify-email-form";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const dynamic = "force-dynamic";

export default async function VerifyEmailPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const email = typeof query.email === "string" ? query.email : "";

  return (
    <main className="authPage">
      <section className="authCard">
        <div className="authBrand">
          <div className="brandMark">W</div>
          <div><strong>WhatsApp Campaigns</strong><span>Account security</span></div>
        </div>
        <div className="authHeading">
          <p className="eyebrow">Verify your identity</p>
          <h1>Verify your email</h1>
          <p>Email verification is required before you can sign in to your account.</p>
        </div>
        <VerifyEmailForm initialEmail={email} />
      </section>
    </main>
  );
}
