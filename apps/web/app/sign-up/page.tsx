import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { auth } from "@/lib/server";

export const dynamic = "force-dynamic";

export default async function SignUpPage() {
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
          <p className="eyebrow">Get started</p>
          <h1>Create your workspace</h1>
          <p>Your first workspace is created automatically. You can connect the business&apos;s own WhatsApp number next.</p>
        </div>
        <AuthForm mode="sign-up" />
      </section>
    </main>
  );
}
