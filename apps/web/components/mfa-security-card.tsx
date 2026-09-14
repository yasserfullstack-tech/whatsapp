"use client";

import { type FormEvent, useEffect, useState } from "react";
import QRCode from "react-qr-code";
import { useI18n } from "@/components/i18n-provider";
import { authClient } from "@/lib/auth-client";
import { productionUiMessages } from "@/lib/i18n/production-ui";

type Enrollment = {
  totpURI: string;
  backupCodes: string[];
  verified: boolean;
};

type AuthError = { message?: string | null | undefined; code?: string | null | undefined };

export function MfaSecurityCard() {
  const { locale } = useI18n();
  const copy = productionUiMessages[locale];
  const sessionQuery = authClient.useSession();
  const sessionMfaEnabled = Boolean((sessionQuery.data?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled);
  const [enabled, setEnabled] = useState(sessionMfaEnabled);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [newBackupCodes, setNewBackupCodes] = useState<string[] | null>(null);

  useEffect(() => {
    if (sessionMfaEnabled) setEnabled(true);
  }, [sessionMfaEnabled]);

  function errorMessage(value: AuthError | null | undefined, fallback: string) {
    if (value?.code === "ACCOUNT_TEMPORARILY_LOCKED") return copy.mfa.locked;
    return value?.message ?? fallback;
  }

  async function startEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setStatus(null);
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");

    try {
      const result = await authClient.twoFactor.enable({ password, method: "totp", issuer: "WhatsApp Campaigns" });
      if (result.error) {
        setError(errorMessage(result.error, copy.mfa.startFailed));
        return;
      }
      if (!result.data || result.data.method !== "totp") {
        setError(copy.mfa.invalidEnrollment);
        return;
      }
      setEnrollment({ totpURI: result.data.totpURI, backupCodes: result.data.backupCodes, verified: false });
      event.currentTarget.reset();
    } finally {
      setPending(false);
    }
  }

  async function verifyEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const code = String(form.get("code") ?? "").replace(/\s+/g, "");

    try {
      const result = await authClient.twoFactor.verifyTotp({ code, trustDevice: true });
      if (result.error) {
        setError(errorMessage(result.error, copy.mfa.verifyFailed));
        return;
      }
      setEnabled(true);
      setEnrollment((current) => current ? { ...current, verified: true } : current);
      setStatus(copy.mfa.enabledStatus);
      event.currentTarget.reset();
    } finally {
      setPending(false);
    }
  }

  async function regenerateBackupCodes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setStatus(null);
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");

    try {
      const result = await authClient.twoFactor.generateBackupCodes({ password });
      if (result.error) {
        setError(errorMessage(result.error, copy.mfa.regenerateFailed));
        return;
      }
      setNewBackupCodes(result.data?.backupCodes ?? []);
      setStatus(copy.mfa.regeneratedStatus);
      event.currentTarget.reset();
    } finally {
      setPending(false);
    }
  }

  async function disableMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setStatus(null);
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");

    try {
      const result = await authClient.twoFactor.disable({ password });
      if (result.error) {
        setError(errorMessage(result.error, copy.mfa.disableFailed));
        return;
      }
      setEnabled(false);
      setEnrollment(null);
      setNewBackupCodes(null);
      setStatus(copy.mfa.disabledStatus);
      event.currentTarget.reset();
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="panel" style={{ gridColumn: "1 / -1" }}>
      <div className="panelHeader">
        <div>
          <p className="eyebrow">{copy.mfa.eyebrow}</p>
          <h2>{copy.mfa.title}</h2>
          <p className="subtitle">{copy.mfa.subtitle}</p>
        </div>
        <span className="badge">{enabled ? copy.mfa.enabled : copy.mfa.notEnabled}</span>
      </div>

      {error ? <p className="formError" role="alert">{error}</p> : null}
      {status ? <p role="status">{status}</p> : null}

      {enrollment ? (
        <div className="authForm">
          <div>
            <h3>{copy.mfa.scanTitle}</h3>
            <p className="subtitle">{copy.mfa.scanHelp}</p>
            <div style={{ background: "white", display: "inline-block", padding: 16 }}>
              <QRCode aria-label={copy.mfa.qrLabel} size={192} value={enrollment.totpURI} />
            </div>
          </div>

          <div>
            <h3>{copy.mfa.saveCodesTitle}</h3>
            <p className="subtitle">{copy.mfa.saveCodesHelp}</p>
            <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
              {enrollment.backupCodes.map((code) => <code key={code}>{code}</code>)}
            </div>
          </div>

          {!enrollment.verified ? (
            <form className="authForm" onSubmit={verifyEnrollment}>
              <h3>{copy.mfa.verifyTitle}</h3>
              <label>
                <span>{copy.mfa.sixDigitCode}</span>
                <input autoComplete="one-time-code" inputMode="numeric" maxLength={6} minLength={6} name="code" pattern="[0-9]{6}" required />
              </label>
              <button className="primary authSubmit" disabled={pending} type="submit">{pending ? copy.mfa.verifying : copy.mfa.verifyEnable}</button>
            </form>
          ) : (
            <button className="primary authSubmit" onClick={() => setEnrollment(null)} type="button">{copy.mfa.savedCodes}</button>
          )}
        </div>
      ) : enabled ? (
        <div className="mainGrid">
          <div>
            <h3>{copy.mfa.recoveryCodes}</h3>
            <p className="subtitle">{copy.mfa.recoveryHelp}</p>
            <form className="authForm" onSubmit={regenerateBackupCodes}>
              <label><span>{copy.common.currentPassword}</span><input autoComplete="current-password" name="password" required type="password" /></label>
              <button className="secondary" disabled={pending} type="submit">{pending ? copy.mfa.generating : copy.mfa.generateCodes}</button>
            </form>
            {newBackupCodes ? (
              <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", marginTop: 16 }}>
                {newBackupCodes.map((code) => <code key={code}>{code}</code>)}
              </div>
            ) : null}
          </div>

          <div>
            <h3>{copy.mfa.disableTitle}</h3>
            <p className="subtitle">{copy.mfa.disableHelp}</p>
            <form className="authForm" onSubmit={disableMfa}>
              <label><span>{copy.common.currentPassword}</span><input autoComplete="current-password" name="password" required type="password" /></label>
              <button className="secondary" disabled={pending} type="submit">{pending ? copy.mfa.disabling : copy.mfa.disable}</button>
            </form>
          </div>
        </div>
      ) : (
        <form className="authForm" onSubmit={startEnrollment}>
          <p>{copy.mfa.confirmPassword}</p>
          <label><span>{copy.common.currentPassword}</span><input autoComplete="current-password" name="password" required type="password" /></label>
          <button className="primary authSubmit" disabled={pending} type="submit">{pending ? copy.mfa.starting : copy.mfa.enable}</button>
        </form>
      )}
    </section>
  );
}
