"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

type SecuritySession = {
  id: string;
  token: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string | Date;
  updatedAt?: string | Date;
  expiresAt: string | Date;
};

function formatDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function describeAgent(userAgent?: string | null) {
  if (!userAgent) return "Unknown device";
  if (/iphone|ipad|ios/i.test(userAgent)) return "Apple mobile device";
  if (/android/i.test(userAgent)) return "Android device";
  if (/windows/i.test(userAgent)) return "Windows device";
  if (/macintosh|mac os/i.test(userAgent)) return "Mac device";
  if (/linux/i.test(userAgent)) return "Linux device";
  return "Browser session";
}

export function AccountSecurityPanel({ currentEmail }: { currentEmail: string }) {
  const router = useRouter();
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

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    setSessionError(null);
    try {
      const result = await authClient.listSessions();
      if (result.error) {
        setSessionError(result.error.message ?? "Unable to load sessions.");
        return;
      }
      setSessions((result.data ?? []) as unknown as SecuritySession[]);
    } finally {
      setSessionsLoading(false);
    }
  }, []);

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
      setPasswordError("New passwords do not match.");
      setPasswordPending(false);
      return;
    }

    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (result.error) {
        setPasswordError(result.error.message ?? "Unable to change password.");
        return;
      }
      event.currentTarget.reset();
      setPasswordStatus("Password changed. Other active sessions were signed out.");
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
      const result = await authClient.changeEmail({
        newEmail,
        callbackURL: "/account/security?emailChanged=1",
      });
      if (result.error) {
        setEmailError(result.error.message ?? "Unable to start email change.");
        return;
      }
      event.currentTarget.reset();
      setEmailStatus("Approval sent to your current email. The new address must also be verified before the change is complete.");
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
        setSessionError(result.error.message ?? "Unable to revoke session.");
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
        setSessionError(result.error.message ?? "Unable to sign out other sessions.");
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
        <div className="panelHeader"><div><p className="eyebrow">Password</p><h2>Change password</h2><p className="subtitle">Changing your password signs out every other active session.</p></div></div>
        <form className="authForm" onSubmit={changePassword}>
          <label><span>Current password</span><input autoComplete="current-password" name="currentPassword" required type="password" /></label>
          <label><span>New password</span><input autoComplete="new-password" minLength={10} name="newPassword" required type="password" /></label>
          <label><span>Confirm new password</span><input autoComplete="new-password" minLength={10} name="confirmPassword" required type="password" /></label>
          {passwordError ? <p className="formError" role="alert">{passwordError}</p> : null}
          {passwordStatus ? <p role="status">{passwordStatus}</p> : null}
          <button className="primary authSubmit" disabled={passwordPending} type="submit">{passwordPending ? "Updating…" : "Change password"}</button>
        </form>
      </section>

      <section className="panel">
        <div className="panelHeader"><div><p className="eyebrow">Email</p><h2>Change account email</h2><p className="subtitle">Current email: {currentEmail}</p></div></div>
        <form className="authForm" onSubmit={changeEmail}>
          <label><span>New email</span><input autoComplete="email" name="newEmail" required type="email" /></label>
          {emailError ? <p className="formError" role="alert">{emailError}</p> : null}
          {emailStatus ? <p role="status">{emailStatus}</p> : null}
          <button className="primary authSubmit" disabled={emailPending} type="submit">{emailPending ? "Sending approval…" : "Change email securely"}</button>
        </form>
      </section>

      <section className="panel" style={{ gridColumn: "1 / -1" }}>
        <div className="panelHeader">
          <div><p className="eyebrow">Sessions</p><h2>Active sessions</h2><p className="subtitle">Review devices signed in to your account and revoke anything you do not recognize.</p></div>
          <button className="secondary" disabled={sessionsPending || sessionsLoading || sessions.length < 2} onClick={revokeOtherSessions} type="button">Log out other sessions</button>
        </div>
        {sessionError ? <p className="formError" role="alert">{sessionError}</p> : null}
        {sessionsLoading ? <p>Loading sessions…</p> : (
          <div className="numberList">
            {orderedSessions.map((session) => {
              const isCurrent = session.id === currentSessionId;
              return (
                <div className="numberRow" key={session.id}>
                  <div>
                    <strong>{describeAgent(session.userAgent)}{isCurrent ? " · This session" : ""}</strong>
                    <p>{session.ipAddress ?? "IP unavailable"} · Signed in {formatDate(session.createdAt)} · Expires {formatDate(session.expiresAt)}</p>
                  </div>
                  <button className="secondary" disabled={sessionsPending} onClick={() => void revokeSession(session)} type="button">{isCurrent ? "Log out" : "Revoke"}</button>
                </div>
              );
            })}
            {!orderedSessions.length ? <p>No active sessions found.</p> : null}
          </div>
        )}
      </section>

      <section className="panel" style={{ gridColumn: "1 / -1" }}>
        <div className="panelHeader"><div><p className="eyebrow">Multi-factor authentication</p><h2>TOTP + recovery codes</h2><p className="subtitle">The MFA data model and enrollment flow are the next security layer. Platform administrators will be able to enforce this capability separately from workspace roles.</p></div></div>
        <button className="secondary" disabled type="button">Enable MFA — foundation pending migration</button>
      </section>
    </div>
  );
}
