"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { authClient } from "@/lib/auth-client";

type AuthFormProps = { mode: "sign-in" | "sign-up" };

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const { messages } = useI18n();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isSignUp = mode === "sign-up";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const name = String(form.get("name") ?? "").trim();

    try {
      const result = isSignUp
        ? await authClient.signUp.email({ name, email, password, callbackURL: "/dashboard" })
        : await authClient.signIn.email({ email, password, callbackURL: "/dashboard" });
      if (result.error) {
        setError(result.error.message ?? messages.auth.authenticationFailed);
        return;
      }

      const requiresSecondFactor = !isSignUp && Boolean(
        (result.data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect,
      );
      if (requiresSecondFactor) {
        router.push("/two-factor");
        return;
      }

      router.push(isSignUp ? `/verify-email?email=${encodeURIComponent(email)}` : "/dashboard");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="authForm" onSubmit={submit}>
      {isSignUp ? <label><span>{messages.auth.name}</span><input autoComplete="name" name="name" placeholder={messages.auth.namePlaceholder} required /></label> : null}
      <label><span>{messages.auth.email}</span><input autoComplete="email" name="email" placeholder={messages.auth.emailPlaceholder} required type="email" /></label>
      <label><span>{messages.auth.password}</span><input autoComplete={isSignUp ? "new-password" : "current-password"} minLength={10} name="password" placeholder={messages.auth.passwordPlaceholder} required type="password" /></label>
      {!isSignUp ? <p className="authSwitch"><Link href="/forgot-password">Forgot password?</Link></p> : null}
      {error ? <p className="formError" role="alert">{error}</p> : null}
      <button className="primary authSubmit" disabled={pending} type="submit">{pending ? messages.auth.pleaseWait : isSignUp ? messages.auth.createAccount : messages.auth.signIn}</button>
      <p className="authSwitch">
        {isSignUp ? `${messages.auth.alreadyHaveAccount} ` : `${messages.auth.newToPlatform} `}
        <Link href={isSignUp ? "/sign-in" : "/sign-up"}>{isSignUp ? messages.auth.signIn : messages.auth.createAccount}</Link>
      </p>
    </form>
  );
}
