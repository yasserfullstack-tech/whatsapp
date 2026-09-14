"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MfaSecurityCard } from "@/components/mfa-security-card";
import { useI18n } from "@/components/i18n-provider";
import { authClient } from "@/lib/auth-client";
import { productionUiMessages } from "@/lib/i18n/production-ui";

type SecuritySession = {
  id: string;
  token: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string | Date;
  updatedAt?: string | Date;
  expiresAt: string | Date;
};

export function AccountSecurityPanel({ currentEmail }: { currentEmail: string }) {
  const router = useRouter();
  const { locale, dateTime, format } = useI18n();
  const copy = productionUiMessages[locale].accountSecurity;
  const sessionQuery = authClient.useSession();
  const currentSessionId = sessionQuery.data?.session.id;
  const [sessions, setSessions] = useState<SecuritySession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [passwordStatus, setPasswordStatus] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordPending, setPasswordPending] = useState(false);
  const [emailStatus, setEmailStatus] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailPending, setEmailPending] = useState(false);
  const [sessionsPending, setSessionsPending] = useState(false);

  function safeDate(value: string | Date) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? copy.unknown : dateTime(date);
  }

  function describeAgent(userAgent?: string | null) {
    if (!userAgent) return copy.unknownDevice;
    if (/iphone|ipad|ios/i.test(userAgent)) return copy.appleDevice;
    if (/android/i.test(userAgent)) return copy.androidDevice;
    if (/windows/i.test(userAgent)) return copy.windowsDevice;
    if (/macintosh|mac os/i.test(userAgent)) return copy.macDevice;
    if (/linux/i.test(userAgent)) return copy.linuxDevice;
    return copy.browserSession;
  }

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    setSessionError(null);
    try {
      const result = await authClient.listSessions();
      if (result.error) {
        setSessionError(result.error.message ?? copy.loadSessionsFailed);
        return;
      }
      setSessions((result.data ?? []) as unknown as SecuritySession[]);
    } finally {
      setSessionsLoading(false);
    }
  }, [copy.loadSessionsFailed]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const orderedSessions = useMemo(
    () => [...sessions].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [sessions],
  );

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordPending(true);
    setPasswordStatus(null);
    setPasswordError(null);
    const form = new FormData(event.currentTarget);
    const currentPassword = String(form.get("currentPassword") ?? "");
    const newPassword = String(form.get("newPassword") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");

    if (newPassword !== confirmPassword) {
      setPasswordError(copy.passwordMismatch);
      setPasswordPending(false);
      return;
    }

    try {
      const result = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
      if (result.error) {
        setPasswordError(result.error.message ?? copy.passwordChangeFailed);
        return;
      }
      event.currentTarget.reset();
      setPasswordStatus(copy.passwordChanged);
      await loadSessions();
    } finally {
      setPasswordPending(false);
    }
  }

  async function changeEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEmailPending(true);
    setEmailStatus(null);
    setEmailError(null);
    const form = new FormData(event.currentTarget);
    const newEmail = String(form.get("newEmail") ?? "").trim();

    try {
      const result = await authClient.changeEmail({ newEmail, callbackURL: "/account/security?emailChanged=1" });
      if (result.error) {
        setEmailError(result.error.message ?? copy.emailChangeFailed);
        return;
      }
      event.currentTarget.reset();
      setEmailStatus(copy.emailChangeSent);
    } finally {
      setEmailPending(false);
    }
  }

  async function revokeSession(session: SecuritySession) {
    setSessionsPending(true);
    setSessionError(null);
    try {
      const result = await authClient.revokeSession({ token: session.token });
      if (result.error) {
        setSessionError(result.error.message ?? copy.revokeFailed);
        return;
      }
      if (session.id === currentSessionId) {
        router.replace("/sign-in");
        router.refresh();
        return;
      }
      await loadSessions();
    } finally {
      setSessionsPending(false);
    }
  }

  async function revokeOtherSessions() {
    setSessionsPending(true);
    setSessionError(null);
    try {
      const result = await authClient.revokeOtherSessions();
      if (result.error) {
        setSessionError(result.error.message ?? copy.revokeOthersFailed);
        return;
      }
      await loadSessions();
    } finally {
      setSessionsPending(false);
    }
  }

  return (
    <div className="mainGrid accountSecurityGrid">
      <section className="panel">
        <div className="panelHeader"><div><p className="eyebrow">{copy.passwordEyebrow}</p><h2>{copy.changePassword}</h2><p className="subtitle">{copy.passwordSubtitle}</p></div></div>
        <form className="authForm" onSubmit={changePassword}>
          <label><span>{productionUiMessages[locale].common.currentPassword}</span><input autoComplete="current-password" name="currentPassword" required type="password" /></label>
          <label><span>{productionUiMessages[locale].common.newPassword}</span><input autoComplete="new-password" minLength={10} name="newPassword" required type="password" /></label>
          <label><span>{productionUiMessages[locale].common.confirmNewPassword}</span><input autoComplete="new-password" minLength={10} name="confirmPassword" required type="password" /></label>
          {passwordError ? <p className="formError" role="alert">{passwordError}</p> : null}
          {passwordStatus ? <p role="status">{passwordStatus}</p> : null}
          <button className="primary authSubmit" disabled={passwordPending} type="submit">{passwordPending ? copy.updating : copy.changePassword}</button>
        </form>
      </section>

      <section className="panel">
        <div className="panelHeader"><div><p className="eyebrow">{copy.emailEyebrow}</p><h2>{copy.changeEmail}</h2><p className="subtitle">{format(copy.currentEmail, { email: currentEmail })}</p></div></div>
        <form className="authForm" onSubmit={changeEmail}>
          <label><span>{copy.newEmail}</span><input autoComplete="email" name="newEmail" required type="email" /></label>
          {emailError ? <p className="formError" role="alert">{emailError}</p> : null}
          {emailStatus ? <p role="status">{emailStatus}</p> : null}
          <button className="primary authSubmit" disabled={emailPending} type="submit">{emailPending ? copy.sendingApproval : copy.changeEmailSecurely}</button>
        </form>
      </section>

      <section className="panel" style={{ gridColumn: "1 / -1" }}>
        <div className="panelHeader">
          <div><p className="eyebrow">{copy.sessionsEyebrow}</p><h2>{copy.activeSessions}</h2><p className="subtitle">{copy.sessionsSubtitle}</p></div>
          <button className="secondary" disabled={sessionsPending || sessionsLoading || sessions.length < 2} onClick={revokeOtherSessions} type="button">{copy.logoutOthers}</button>
        </div>
        {sessionError ? <p className="formError" role="alert">{sessionError}</p> : null}
        {sessionsLoading ? <p>{copy.loadingSessions}</p> : (
          <div className="numberList">
            {orderedSessions.map((session) => {
              const isCurrent = session.id === currentSessionId;
              return (
                <div className="numberRow" key={session.id}>
                  <div>
                    <strong>{describeAgent(session.userAgent)}{isCurrent ? ` · ${copy.thisSession}` : ""}</strong>
                    <p>{session.ipAddress ?? copy.ipUnavailable} · {format(copy.signedIn, { date: safeDate(session.createdAt) })} · {format(copy.expires, { date: safeDate(session.expiresAt) })}</p>
                  </div>
                  <button className="secondary" disabled={sessionsPending} onClick={() => void revokeSession(session)} type="button">{isCurrent ? copy.logout : copy.revoke}</button>
                </div>
              );
            })}
            {!orderedSessions.length ? <p>{copy.noSessions}</p> : null}
          </div>
        )}
      </section>

      <MfaSecurityCard />
    </div>
  );
}
