"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { authClient } from "@/lib/auth-client";
import { productionUiMessages } from "@/lib/i18n/production-ui";

export function ResetPasswordForm({ token, invalidToken }: { token?: string; invalidToken?: boolean }) {
  const router = useRouter();
  const { locale } = useI18n();
  const copy = productionUiMessages[locale];
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(invalidToken ? copy.resetPassword.invalid : null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      setError(copy.resetPassword.invalid);
      return;
    }

    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");
    if (password !== confirmPassword) {
      setError(copy.resetPassword.mismatch);
      return;
    }

    setPending(true);
    setError(null);
    try {
      const result = await authClient.resetPassword({ newPassword: password, token });
      if (result.error) {
        setError(result.error.message ?? copy.resetPassword.failed);
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
        <span>{copy.common.newPassword}</span>
        <input autoComplete="new-password" minLength={10} name="password" required type="password" />
      </label>
      <label>
        <span>{copy.common.confirmNewPassword}</span>
        <input autoComplete="new-password" minLength={10} name="confirmPassword" required type="password" />
      </label>
      {error ? <p className="formError" role="alert">{error}</p> : null}
      <button className="primary authSubmit" disabled={pending || !token} type="submit">{pending ? copy.resetPassword.resetting : copy.resetPassword.submit}</button>
      <p className="authSwitch"><Link href="/forgot-password">{copy.resetPassword.requestNew}</Link></p>
    </form>
  );
}
