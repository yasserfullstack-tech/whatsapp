"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useI18n } from "@/components/i18n-provider";

type ContactRow = { id: string; phoneE164: string; displayName: string | null; optedIn: boolean; optInSource: string | null; optInAt: string | null; unsubscribedAt: string | null; suppressedAt: string | null; suppressionReason: string | null; suppressionSource: string | null };
type ConsentEvent = { id: string; phoneE164: string; eventType: string; source: string; note: string | null; occurredAt: string };
type ActionMode = "suppress" | "resubscribe";
type ContactAction = { mode: ActionMode; contactId: string };
type Props = { contacts: ContactRow[]; events: ConsentEvent[]; canSuppress: boolean; canResubscribe: boolean; initialAction?: ContactAction | null };
function localDateTimeDefault(): string { const now = new Date(); const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000); return local.toISOString().slice(0, 16); }

export function ContactSuppressionManager({ contacts, events, canSuppress, canResubscribe, initialAction = null }: Props) {
  const { messages, dateTime, format } = useI18n();
  const [rows, setRows] = useState(contacts);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [action, setAction] = useState<ContactAction | null>(initialAction);

  useEffect(() => { setHydrated(true); }, []);
  useEffect(() => { setRows(contacts); }, [contacts]);
  useEffect(() => { setAction(initialAction); }, [initialAction]);

  const selected = action ? rows.find((contact) => contact.id === action.contactId) ?? null : null;
  const selectedEligible = selected ? selected.optedIn && !selected.unsubscribedAt && !selected.suppressedAt : false;
  const mode: ActionMode | null = action?.mode === "suppress" && selected && canSuppress && !selected.suppressedAt
    ? "suppress"
    : action?.mode === "resubscribe" && selected && canResubscribe && !selectedEligible
      ? "resubscribe"
      : null;

  function clearRouteAction() {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.delete("contactAction");
    url.searchParams.delete("contactId");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function openAction(contact: ContactRow, nextMode: ActionMode) {
    setMessage(null);
    if (nextMode === "resubscribe") {
      const url = new URL(window.location.href);
      url.searchParams.set("contactAction", "resubscribe");
      url.searchParams.set("contactId", contact.id);
      window.location.assign(`${url.pathname}${url.search}${url.hash}`);
      return;
    }
    setAction({ mode: nextMode, contactId: contact.id });
  }

  function close() {
    setAction(null);
    clearRouteAction();
  }

  async function submitSuppress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return;
    const form = new FormData(event.currentTarget);
    const reason = String(form.get("reason") ?? "");
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/contacts/${selected.id}/suppress`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? messages.ui.suppressFailed);
      const suppressedAt = new Date().toISOString();
      setRows((current) => current.map((contact) => contact.id === selected.id ? {
        ...contact,
        optedIn: false,
        unsubscribedAt: suppressedAt,
        suppressedAt,
        suppressionReason: reason,
        suppressionSource: "dashboard_manual",
      } : contact));
      setMessage(format(messages.ui.suppressedSuccess, { phone: selected.phoneE164 }));
      setAction(null);
    }
    catch (error) { setMessage(error instanceof Error ? error.message : messages.ui.suppressFailed); }
    finally { setBusy(false); }
  }

  async function submitResubscribe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return;
    const form = new FormData(event.currentTarget);
    const consentSource = String(form.get("consentSource") ?? "");
    const consentedAt = new Date(String(form.get("consentedAt") ?? ""));
    if (Number.isNaN(consentedAt.getTime())) { setMessage(messages.ui.invalidConsentDate); return; }
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/contacts/${selected.id}/resubscribe`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ consentSource, consentedAt: consentedAt.toISOString(), evidenceNote: String(form.get("evidenceNote") ?? ""), confirmation: form.get("confirmation") === "on" }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? messages.ui.restoreFailed);
      setRows((current) => current.map((contact) => contact.id === selected.id ? {
        ...contact,
        optedIn: true,
        optInSource: consentSource,
        optInAt: consentedAt.toISOString(),
        unsubscribedAt: null,
        suppressedAt: null,
        suppressionReason: null,
        suppressionSource: null,
      } : contact));
      setMessage(format(messages.ui.restoredSuccess, { phone: selected.phoneE164 }));
      setAction(null);
      clearRouteAction();
    }
    catch (error) { setMessage(error instanceof Error ? error.message : messages.ui.restoreFailed); }
    finally { setBusy(false); }
  }

  return <div className="contactManagementGrid"><section>
    {message ? <p className="contactNotice" role="status">{message}</p> : null}
    {selected && mode === "suppress" ? <form className="consentActionForm" onSubmit={submitSuppress}><div><p className="eyebrow">{messages.ui.manualSuppression}</p><h3>{selected.displayName ?? selected.phoneE164}</h3><p className="subtitle">{messages.ui.suppressionDescription}</p></div><label><span>{messages.ui.reason}</span><textarea name="reason" defaultValue={messages.ui.defaultSuppressionReason} minLength={3} maxLength={240} required /></label><div className="formActions"><button className="primary" disabled={busy} type="submit">{busy ? messages.common.saving : messages.ui.suppressContact}</button><button className="secondary" disabled={busy} onClick={close} type="button">{messages.common.cancel}</button></div></form> : null}
    {selected && mode === "resubscribe" ? <form className="consentActionForm" onSubmit={submitResubscribe}><div><p className="eyebrow">{messages.ui.newConsentRequired}</p><h3>{selected.displayName ?? selected.phoneE164}</h3><p className="subtitle">{messages.ui.resubscribeDescription}</p></div><label><span>{messages.ui.consentSource}</span><input name="consentSource" placeholder={messages.ui.consentSourcePlaceholder} minLength={3} maxLength={160} required /></label><label><span>{messages.ui.consentDateTime}</span><input name="consentedAt" type="datetime-local" defaultValue={localDateTimeDefault()} required /></label><label><span>{messages.ui.evidenceNote}</span><textarea name="evidenceNote" placeholder={messages.ui.evidencePlaceholder} minLength={8} maxLength={1000} required /></label><label className="confirmationRow"><input name="confirmation" type="checkbox" required /><span>{messages.ui.newConsentConfirmation}</span></label><div className="formActions"><button className="primary" disabled={busy} type="submit">{busy ? messages.common.saving : messages.ui.restoreEligibility}</button><button className="secondary" disabled={busy} onClick={close} type="button">{messages.common.cancel}</button></div></form> : null}
    <div className="contactRows">{rows.length ? rows.map((contact) => { const eligible = contact.optedIn && !contact.unsubscribedAt && !contact.suppressedAt; const status = contact.suppressedAt ? messages.ui.suppressed : eligible ? messages.ui.eligible : messages.ui.needsConsent; return <article className="contactRow" key={contact.id}><div className="contactIdentity"><strong>{contact.displayName ?? messages.ui.unnamedContact}</strong><span dir="ltr">{contact.phoneE164}</span><small>{contact.optInSource ? format(messages.ui.consentLabel, { source: contact.optInSource }) : messages.ui.noConsentSource}</small></div><div className="contactState"><span className={eligible ? "eligibilityBadge eligible" : contact.suppressedAt ? "eligibilityBadge suppressed" : "eligibilityBadge"}>{status}</span>{contact.suppressedAt ? <small>{contact.suppressionReason ?? messages.ui.suppressed} · {dateTime(contact.suppressedAt)}</small> : contact.unsubscribedAt ? <small>{format(messages.ui.optedOutAt, { date: dateTime(contact.unsubscribedAt) })}</small> : null}</div><div className="contactActions">{canSuppress && !contact.suppressedAt ? <button className="secondary" disabled={!hydrated || busy} onClick={() => openAction(contact, "suppress")} type="button">{messages.ui.suppress}</button> : null}{canResubscribe && !eligible ? <button className="textButton" disabled={!hydrated || busy} onClick={() => openAction(contact, "resubscribe")} type="button">{messages.ui.recordNewConsent}</button> : null}</div></article>; }) : <div className="emptyState"><div className="emptyIcon">C</div><h3>{messages.ui.noContactsMatch}</h3><p>{messages.ui.noContactsMatchDescription}</p></div>}</div>
  </section><aside className="consentHistory"><p className="eyebrow">{messages.ui.consentHistory}</p><h2>{messages.ui.recentEvents}</h2><p className="subtitle">{messages.ui.historyAppendOnly}</p><div className="numberList">{events.length ? events.map((event) => <div className="consentEvent" key={event.id}><div><strong>{event.eventType.replaceAll("_", " ")}</strong><p dir="ltr">{event.phoneE164}</p></div><div><span>{event.source}</span><small>{dateTime(event.occurredAt)}</small>{event.note ? <small>{event.note}</small> : null}</div></div>) : <p className="subtitle">{messages.ui.noConsentEvents}</p>}</div></aside></div>;
}
