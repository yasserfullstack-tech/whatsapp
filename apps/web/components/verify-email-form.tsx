"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { authClient } from "@/lib/auth-client";

export function VerifyEmailForm({ initialEmail = "" }: { initialEmail?: string }) {
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
        setError(result.error.message ?? "Unable to send verification email.");
        return;
      }
      setSent(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="authForm" onSubmit={submit}>
      {sent ? <p>Check your inbox for a verification link. You can resend it below if needed.</p> : null}
      <label>
        <span>Email</span>
        <input autoComplete="email" defaultValue={initialEmail} name="email" placeholder="you@company.com" required type="email" />
      </label>
      {error ? <p className="formError" role="alert">{error}</p> : null}
      <button className="primary authSubmit" disabled={pending} type="submit">{pending ? "Sending…" : "Resend verification email"}</button>
      <p className="authSwitch"><Link href="/sign-in">Back to sign in</Link></p>
    </form>
  );
}
