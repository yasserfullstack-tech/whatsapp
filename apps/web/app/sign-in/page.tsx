import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getI18n } from "@/lib/i18n/server";
import { auth } from "@/lib/server";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect("/dashboard");
  const { messages } = await getI18n();

  return (
    <main className="authPage">
      <section className="authCard">
        <div className="authBrand">
          <div className="brandMark">W</div>
          <div><strong>{messages.meta.title}</strong><span>{messages.auth.brandSubtitle}</span></div>
        </div>
        <div className="authHeading">
          <p className="eyebrow">{messages.auth.welcomeBack}</p>
          <h1>{messages.auth.signIn}</h1>
          <p>{messages.auth.signInDescription}</p>
        </div>
        <AuthForm mode="sign-in" />
      </section>
    </main>
  );
}
