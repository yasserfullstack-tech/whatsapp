import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { auth } from "@/lib/server";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect("/dashboard");

  return (
    <main className="authPage">
      <section className="authCard">
        <div className="authBrand">
          <div className="brandMark">W</div>
          <div>
            <strong>WhatsApp Campaigns</strong>
            <span>Business messaging platform</span>
          </div>
        </div>
        <div className="authHeading">
          <p className="eyebrow">Welcome back</p>
          <h1>Sign in</h1>
          <p>Manage WhatsApp connections, contacts, templates, and campaigns from one workspace.</p>
        </div>
        <AuthForm mode="sign-in" />
      </section>
    </main>
  );
}
