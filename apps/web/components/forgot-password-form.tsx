"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { authClient } from "@/lib/auth-client";

export function ForgotPasswordForm() {
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
        setError(result.error.message ?? "Unable to request a password reset.");
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
        <p>If an account exists for that email, a password reset link has been sent.</p>
        <p className="authSwitch"><Link href="/sign-in">Back to sign in</Link></p>
      </div>
    );
  }

  return (
    <form className="authForm" onSubmit={submit}>
      <label>
        <span>Email</span>
        <input autoComplete="email" name="email" placeholder="you@company.com" required type="email" />
      </label>
      {error ? <p className="formError" role="alert">{error}</p> : null}
      <button className="primary authSubmit" disabled={pending} type="submit">{pending ? "Sending…" : "Send reset link"}</button>
      <p className="authSwitch"><Link href="/sign-in">Back to sign in</Link></p>
    </form>
  );
}
