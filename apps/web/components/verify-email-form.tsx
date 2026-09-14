"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { authClient } from "@/lib/auth-client";
import { productionUiMessages } from "@/lib/i18n/production-ui";

export function VerifyEmailForm({ initialEmail = "" }: { initialEmail?: string }) {
  const { locale } = useI18n();
  const copy = productionUiMessages[locale];
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(Boolean(initialEmail));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();

    try {
      const result = await authClient.sendVerificationEmail({
        email,
        callbackURL: "/sign-in?verified=1",
      });
      if (result.error) {
        setError(result.error.message ?? copy.verifyEmail.failed);
        return;
      }
      setSent(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="authForm" onSubmit={submit}>
      {sent ? <p>{copy.verifyEmail.sent}</p> : null}
      <label>
        <span>{copy.common.email}</span>
        <input autoComplete="email" defaultValue={initialEmail} name="email" placeholder={copy.common.emailPlaceholder} required type="email" />
      </label>
      {error ? <p className="formError" role="alert">{error}</p> : null}
      <button className="primary authSubmit" disabled={pending} type="submit">{pending ? copy.verifyEmail.sending : copy.verifyEmail.resend}</button>
      <p className="authSwitch"><Link href="/sign-in">{copy.common.backToSignIn}</Link></p>
    </form>
  );
}
