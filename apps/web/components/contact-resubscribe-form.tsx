"use client";

import { type FormEvent, useState } from "react";
import { useI18n } from "@/components/i18n-provider";

type Props = {
  contactId: string;
  phoneE164: string;
  displayName: string | null;
};

function localDateTimeDefault() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function ContactResubscribeForm({ contactId, phoneE164, displayName }: Props) {
  const { messages, format } = useI18n();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const consentSource = String(form.get("consentSource") ?? "");
    const consentedAt = new Date(String(form.get("consentedAt") ?? ""));
    if (Number.isNaN(consentedAt.getTime())) {
      setMessage(messages.ui.invalidConsentDate);
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/contacts/${contactId}/resubscribe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          consentSource,
          consentedAt: consentedAt.toISOString(),
          evidenceNote: String(form.get("evidenceNote") ?? ""),
          confirmation: form.get("confirmation") === "on",
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? messages.ui.restoreFailed);
      setMessage(format(messages.ui.restoredSuccess, { phone: phoneE164 }));
      event.currentTarget.reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : messages.ui.restoreFailed);
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel">
    {message ? <p className="contactNotice" role="status">{message}</p> : null}
    <form className="consentActionForm" onSubmit={submit}>
      <div>
        <p className="eyebrow">{messages.ui.newConsentRequired}</p>
        <h3>{displayName ?? phoneE164}</h3>
        <p className="subtitle">{messages.ui.resubscribeDescription}</p>
      </div>
      <label><span>{messages.ui.consentSource}</span><input name="consentSource" placeholder={messages.ui.consentSourcePlaceholder} minLength={3} maxLength={160} required /></label>
      <label><span>{messages.ui.consentDateTime}</span><input name="consentedAt" type="datetime-local" defaultValue={localDateTimeDefault()} required /></label>
      <label><span>{messages.ui.evidenceNote}</span><textarea name="evidenceNote" placeholder={messages.ui.evidencePlaceholder} minLength={8} maxLength={1000} required /></label>
      <label className="confirmationRow"><input name="confirmation" type="checkbox" required /><span>{messages.ui.newConsentConfirmation}</span></label>
      <div className="formActions"><button className="primary" disabled={busy} type="submit">{busy ? messages.common.saving : messages.ui.restoreEligibility}</button></div>
    </form>
  </section>;
}
