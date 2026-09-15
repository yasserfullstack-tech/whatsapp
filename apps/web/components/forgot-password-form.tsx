"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { authClient } from "@/lib/auth-client";
import { productionUiMessages } from "@/lib/i18n/production-ui";

export function ForgotPasswordForm() {
  const { locale } = useI18n();
  const copy = productionUiMessages[locale];
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();

    try {
      const result = await authClient.requestPasswordReset({
        email,
        redirectTo: "/reset-password",
      });
      if (result.error) {
        setError(result.error.message ?? copy.forgotPassword.requestFailed);
        return;
      }
      setSent(true);
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <div className="authForm">
        <p role="status">{copy.forgotPassword.sent}</p>
        <p className="authSwitch"><Link href="/sign-in">{copy.common.backToSignIn}</Link></p>
      </div>
    );
  }

  return (
    <form className="authForm" onSubmit={submit}>
      <label>
        <span>{copy.common.email}</span>
        <input autoComplete="email" name="email" placeholder={copy.common.emailPlaceholder} required type="email" />
      </label>
      {error ? <p className="formError" role="alert">{error}</p> : null}
      <button className="primary authSubmit" disabled={pending} type="submit">{pending ? copy.forgotPassword.sending : copy.forgotPassword.submit}</button>
      <p className="authSwitch"><Link href="/sign-in">{copy.common.backToSignIn}</Link></p>
    </form>
  );
}
