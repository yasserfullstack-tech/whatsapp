"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { authClient } from "@/lib/auth-client";

type Mode = "totp" | "backup";

function twoFactorError(error: { message?: string | null; code?: string | null } | null | undefined) {
  if (error?.code === "ACCOUNT_TEMPORARILY_LOCKED") {
    return "Too many failed attempts. This account is temporarily locked from MFA verification.";
  }
  return error?.message ?? "Unable to verify that code.";
}

export function TwoFactorForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("totp");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        setError(twoFactorError(result.error));
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
        <span>{mode === "totp" ? "Authenticator code" : "Recovery code"}</span>
        <input
          autoComplete="one-time-code"
          autoFocus
          inputMode={mode === "totp" ? "numeric" : "text"}
          maxLength={mode === "totp" ? 6 : 64}
          minLength={mode === "totp" ? 6 : 1}
          name="code"
          pattern={mode === "totp" ? "[0-9]{6}" : undefined}
          placeholder={mode === "totp" ? "123456" : "Recovery code"}
          required
        />
      </label>
      {error ? <p className="formError" role="alert">{error}</p> : null}
      <button className="primary authSubmit" disabled={pending} type="submit">
        {pending ? "Verifying…" : mode === "totp" ? "Verify authenticator code" : "Use recovery code"}
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
        {mode === "totp" ? "Use a recovery code instead" : "Use authenticator code instead"}
      </button>
      <p className="authSwitch"><Link href="/sign-in">Cancel and return to sign in</Link></p>
    </form>
  );
}
