"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { authClient } from "@/lib/auth-client";
import { productionUiMessages } from "@/lib/i18n/production-ui";

type Mode = "totp" | "backup";
type AuthError = { message?: string | null; code?: string | null };

export function TwoFactorForm() {
  const router = useRouter();
  const { locale } = useI18n();
  const copy = productionUiMessages[locale].twoFactor;
  const [mode, setMode] = useState<Mode>("totp");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function errorMessage(value: AuthError | null | undefined) {
    if (value?.code === "ACCOUNT_TEMPORARILY_LOCKED") return copy.locked;
    return value?.message ?? copy.failed;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const code = String(form.get("code") ?? "").trim();

    try {
      const result = mode === "totp"
        ? await authClient.twoFactor.verifyTotp({ code: code.replace(/\s+/g, ""), trustDevice: true })
        : await authClient.twoFactor.verifyBackupCode({ code, trustDevice: true });
      if (result.error) {
        setError(errorMessage(result.error));
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="authForm" onSubmit={submit}>
      <label>
        <span>{mode === "totp" ? copy.authenticatorCode : copy.recoveryCode}</span>
        <input
          autoComplete="one-time-code"
          autoFocus
          inputMode={mode === "totp" ? "numeric" : "text"}
          maxLength={mode === "totp" ? 6 : 64}
          minLength={mode === "totp" ? 6 : 1}
          name="code"
          pattern={mode === "totp" ? "[0-9]{6}" : undefined}
          placeholder={mode === "totp" ? "123456" : copy.recoveryCode}
          required
        />
      </label>
      {error ? <p className="formError" role="alert">{error}</p> : null}
      <button className="primary authSubmit" disabled={pending} type="submit">
        {pending ? copy.verifying : mode === "totp" ? copy.verifyAuthenticator : copy.useRecovery}
      </button>
      <button
        className="secondary"
        disabled={pending}
        onClick={() => {
          setError(null);
          setMode((current) => current === "totp" ? "backup" : "totp");
        }}
        type="button"
      >
        {mode === "totp" ? copy.recoveryInstead : copy.authenticatorInstead}
      </button>
      <p className="authSwitch"><Link href="/sign-in">{copy.cancel}</Link></p>
    </form>
  );
}
