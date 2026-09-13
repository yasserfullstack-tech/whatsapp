"use client";

import { type FormEvent, useEffect, useState } from "react";
import QRCode from "react-qr-code";
import { authClient } from "@/lib/auth-client";

type Enrollment = {
  totpURI: string;
  backupCodes: string[];
  verified: boolean;
};

type AuthError = {
  message?: string | null | undefined;
  code?: string | null | undefined;
};

function errorMessage(error: AuthError | null | undefined, fallback: string) {
  if (error?.code === "ACCOUNT_TEMPORARILY_LOCKED") {
    return "Too many failed MFA attempts. Try again after the temporary lock expires.";
  }
  return error?.message ?? fallback;
}

export function MfaSecurityCard() {
  const sessionQuery = authClient.useSession();
  const sessionMfaEnabled = Boolean(
    (sessionQuery.data?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled,
  );
  const [enabled, setEnabled] = useState(sessionMfaEnabled);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [newBackupCodes, setNewBackupCodes] = useState<string[] | null>(null);

  useEffect(() => {
    if (sessionMfaEnabled) setEnabled(true);
  }, [sessionMfaEnabled]);

  async function startEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setStatus(null);
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");

    try {
      const result = await authClient.twoFactor.enable({
        password,
        method: "totp",
        issuer: "WhatsApp Campaigns",
      });
      if (result.error) {
        setError(errorMessage(result.error, "Unable to start MFA enrollment."));
        return;
      }
      if (!result.data || result.data.method !== "totp") {
        setError("The authenticator enrollment response was not valid.");
        return;
      }
      setEnrollment({
        totpURI: result.data.totpURI,
        backupCodes: result.data.backupCodes,
        verified: false,
      });
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
        setError(errorMessage(result.error, "That authenticator code could not be verified."));
        return;
      }
      setEnabled(true);
      setEnrollment((current) => current ? { ...current, verified: true } : current);
      setStatus("MFA is enabled. Save the recovery codes below before closing this setup.");
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
        setError(errorMessage(result.error, "Unable to generate new recovery codes."));
        return;
      }
      setNewBackupCodes(result.data?.backupCodes ?? []);
      setStatus("New recovery codes generated. Previous recovery codes no longer work.");
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
        setError(errorMessage(result.error, "Unable to disable MFA."));
        return;
      }
      setEnabled(false);
      setEnrollment(null);
      setNewBackupCodes(null);
      setStatus("MFA has been disabled for this account.");
      event.currentTarget.reset();
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="panel" style={{ gridColumn: "1 / -1" }}>
      <div className="panelHeader">
        <div>
          <p className="eyebrow">Multi-factor authentication</p>
          <h2>TOTP + recovery codes</h2>
          <p className="subtitle">
            Use an authenticator app for a second sign-in factor. Platform-administrator policy can require this independently of workspace roles.
          </p>
        </div>
        <span className="badge">{enabled ? "Enabled" : "Not enabled"}</span>
      </div>

      {error ? <p className="formError" role="alert">{error}</p> : null}
      {status ? <p role="status">{status}</p> : null}

      {enrollment ? (
        <div className="authForm">
          <div>
            <h3>1. Scan this QR code</h3>
            <p className="subtitle">Scan with your authenticator app. This setup QR is shown only while you are enrolling.</p>
            <div style={{ background: "white", display: "inline-block", padding: 16 }}>
              <QRCode aria-label="Authenticator setup QR code" size={192} value={enrollment.totpURI} />
            </div>
          </div>

          <div>
            <h3>2. Save recovery codes</h3>
            <p className="subtitle">Each code can be used once. Store them somewhere separate from your authenticator device.</p>
            <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
              {enrollment.backupCodes.map((code) => <code key={code}>{code}</code>)}
            </div>
          </div>

          {!enrollment.verified ? (
            <form className="authForm" onSubmit={verifyEnrollment}>
              <h3>3. Verify setup</h3>
              <label>
                <span>6-digit authenticator code</span>
                <input autoComplete="one-time-code" inputMode="numeric" maxLength={6} minLength={6} name="code" pattern="[0-9]{6}" required />
              </label>
              <button className="primary authSubmit" disabled={pending} type="submit">{pending ? "Verifying…" : "Verify and enable MFA"}</button>
            </form>
          ) : (
            <button className="primary authSubmit" onClick={() => setEnrollment(null)} type="button">I saved my recovery codes</button>
          )}
        </div>
      ) : enabled ? (
        <div className="mainGrid">
          <div>
            <h3>Recovery codes</h3>
            <p className="subtitle">Generate a new set if your current recovery codes are lost. This invalidates the previous set.</p>
            <form className="authForm" onSubmit={regenerateBackupCodes}>
              <label><span>Current password</span><input autoComplete="current-password" name="password" required type="password" /></label>
              <button className="secondary" disabled={pending} type="submit">{pending ? "Generating…" : "Generate new recovery codes"}</button>
            </form>
            {newBackupCodes ? (
              <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", marginTop: 16 }}>
                {newBackupCodes.map((code) => <code key={code}>{code}</code>)}
              </div>
            ) : null}
          </div>

          <div>
            <h3>Disable MFA</h3>
            <p className="subtitle">Disabling MFA removes the authenticator secret and recovery codes from your account.</p>
            <form className="authForm" onSubmit={disableMfa}>
              <label><span>Current password</span><input autoComplete="current-password" name="password" required type="password" /></label>
              <button className="secondary" disabled={pending} type="submit">{pending ? "Disabling…" : "Disable MFA"}</button>
            </form>
          </div>
        </div>
      ) : (
        <form className="authForm" onSubmit={startEnrollment}>
          <p>Confirm your password to begin authenticator setup.</p>
          <label><span>Current password</span><input autoComplete="current-password" name="password" required type="password" /></label>
          <button className="primary authSubmit" disabled={pending} type="submit">{pending ? "Starting…" : "Enable MFA"}</button>
        </form>
      )}
    </section>
  );
}
