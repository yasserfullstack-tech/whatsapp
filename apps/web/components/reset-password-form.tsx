"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { authClient } from "@/lib/auth-client";

export function ResetPasswordForm({ token, invalidToken }: { token?: string; invalidToken?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(invalidToken ? "This reset link is invalid or has expired." : null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      setError("This reset link is invalid or has expired.");
      return;
    }

    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setPending(true);
    setError(null);
    try {
      const result = await authClient.resetPassword({ newPassword: password, token });
      if (result.error) {
        setError(result.error.message ?? "Unable to reset password.");
        return;
      }
      router.replace("/sign-in?passwordReset=1");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="authForm" onSubmit={submit}>
      <label>
        <span>New password</span>
        <input autoComplete="new-password" minLength={10} name="password" required type="password" />
      </label>
      <label>
        <span>Confirm new password</span>
        <input autoComplete="new-password" minLength={10} name="confirmPassword" required type="password" />
      </label>
      {error ? <p className="formError" role="alert">{error}</p> : null}
      <button className="primary authSubmit" disabled={pending || !token} type="submit">{pending ? "Resetting…" : "Reset password"}</button>
      <p className="authSwitch"><Link href="/forgot-password">Request a new reset link</Link></p>
    </form>
  );
}
