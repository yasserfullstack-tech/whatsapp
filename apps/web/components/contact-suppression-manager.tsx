"use client";

import { type FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type ContactRow = {
  id: string;
  phoneE164: string;
  displayName: string | null;
  optedIn: boolean;
  optInSource: string | null;
  optInAt: string | null;
  unsubscribedAt: string | null;
  suppressedAt: string | null;
  suppressionReason: string | null;
  suppressionSource: string | null;
};

type ConsentEvent = {
  id: string;
  phoneE164: string;
  eventType: string;
  source: string;
  note: string | null;
  occurredAt: string;
};

type Props = {
  contacts: ContactRow[];
  events: ConsentEvent[];
  canSuppress: boolean;
  canResubscribe: boolean;
};

type ActionMode = "suppress" | "resubscribe";

function readableEvent(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function localDateTimeDefault(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function ContactSuppressionManager({ contacts, events, canSuppress, canResubscribe }: Props) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<ActionMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const selected = useMemo(() => contacts.find((contact) => contact.id === selectedId) ?? null, [contacts, selectedId]);

  async function submitSuppress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/contacts/${selected.id}/suppress`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: String(form.get("reason") ?? "") }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not suppress contact");
      setMessage(`${selected.phoneE164} is suppressed for future marketing sends.`);
      setMode(null);
      setSelectedId(null);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not suppress contact");
    } finally {
      setBusy(false);
    }
  }

  async function submitResubscribe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    const rawDate = String(form.get("consentedAt") ?? "");
    const consentedAt = new Date(rawDate);
    if (Number.isNaN(consentedAt.getTime())) {
      setMessage("Enter a valid consent date and time.");
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/contacts/${selected.id}/resubscribe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          consentSource: String(form.get("consentSource") ?? ""),
          consentedAt: consentedAt.toISOString(),
          evidenceNote: String(form.get("evidenceNote") ?? ""),
          confirmation: form.get("confirmation") === "on",
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not restore consent");
      setMessage(`${selected.phoneE164} is eligible for future campaigns using the recorded new consent.`);
      setMode(null);
      setSelectedId(null);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not restore consent");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="contactManagementGrid">
      <section>
        {message ? <p className="contactNotice">{message}</p> : null}
        {selected && mode === "suppress" ? (
          <form className="consentActionForm" onSubmit={submitSuppress}>
            <div><p className="eyebrow">Manual suppression</p><h3>{selected.displayName ?? selected.phoneE164}</h3><p className="subtitle">This immediately blocks future marketing sends and skips any pending/queued recipient for this number.</p></div>
            <label><span>Reason</span><textarea name="reason" defaultValue="Customer requested no marketing messages" minLength={3} maxLength={240} required /></label>
            <div className="formActions"><button className="primary" disabled={busy} type="submit">{busy ? "Saving…" : "Suppress contact"}</button><button className="secondary" disabled={busy} onClick={() => { setMode(null); setSelectedId(null); }} type="button">Cancel</button></div>
          </form>
        ) : null}

        {selected && mode === "resubscribe" ? (
          <form className="consentActionForm" onSubmit={submitResubscribe}>
            <div><p className="eyebrow">New consent required</p><h3>{selected.displayName ?? selected.phoneE164}</h3><p className="subtitle">Record fresh consent evidence. This only affects future campaigns; recipients skipped in older campaigns remain skipped.</p></div>
            <label><span>Consent source</span><input name="consentSource" placeholder="Website checkout form, signed form, support chat…" minLength={3} maxLength={160} required /></label>
            <label><span>Consent date and time</span><input name="consentedAt" type="datetime-local" defaultValue={localDateTimeDefault()} required /></label>
            <label><span>Evidence note</span><textarea name="evidenceNote" placeholder="Describe where the new consent is recorded and what the customer agreed to." minLength={8} maxLength={1000} required /></label>
            <label className="confirmationRow"><input name="confirmation" type="checkbox" required /><span>I confirm this is new marketing consent obtained after the previous opt-out/suppression.</span></label>
            <div className="formActions"><button className="primary" disabled={busy} type="submit">{busy ? "Saving…" : "Restore marketing eligibility"}</button><button className="secondary" disabled={busy} onClick={() => { setMode(null); setSelectedId(null); }} type="button">Cancel</button></div>
          </form>
        ) : null}

        <div className="contactRows">
          {contacts.length ? contacts.map((contact) => {
            const eligible = contact.optedIn && !contact.unsubscribedAt && !contact.suppressedAt;
            const status = contact.suppressedAt ? "Suppressed" : eligible ? "Eligible" : "Needs consent";
            return (
              <article className="contactRow" key={contact.id}>
                <div className="contactIdentity"><strong>{contact.displayName ?? "Unnamed contact"}</strong><span>{contact.phoneE164}</span><small>{contact.optInSource ? `Consent: ${contact.optInSource}` : "No consent source recorded"}</small></div>
                <div className="contactState"><span className={eligible ? "eligibilityBadge eligible" : contact.suppressedAt ? "eligibilityBadge suppressed" : "eligibilityBadge"}>{status}</span>{contact.suppressedAt ? <small>{contact.suppressionReason ?? "Suppressed"} · {new Date(contact.suppressedAt).toLocaleString()}</small> : contact.unsubscribedAt ? <small>Opted out {new Date(contact.unsubscribedAt).toLocaleString()}</small> : null}</div>
                <div className="contactActions">
                  {canSuppress && !contact.suppressedAt ? <button className="secondary" onClick={() => { setSelectedId(contact.id); setMode("suppress"); setMessage(null); }} type="button">Suppress</button> : null}
                  {canResubscribe && !eligible ? <button className="textButton" onClick={() => { setSelectedId(contact.id); setMode("resubscribe"); setMessage(null); }} type="button">Record new consent</button> : null}
                </div>
              </article>
            );
          }) : <div className="emptyState"><div className="emptyIcon">C</div><h3>No contacts match</h3><p>Adjust the search/status filter or import contacts from the Overview page.</p></div>}
        </div>
      </section>

      <aside className="consentHistory">
        <p className="eyebrow">Consent history</p><h2>Recent events</h2><p className="subtitle">History is append-only even when active suppression is later cleared after new consent.</p>
        <div className="numberList">
          {events.length ? events.map((event) => <div className="consentEvent" key={event.id}><div><strong>{readableEvent(event.eventType)}</strong><p>{event.phoneE164}</p></div><div><span>{event.source}</span><small>{new Date(event.occurredAt).toLocaleString()}</small>{event.note ? <small>{event.note}</small> : null}</div></div>) : <p className="subtitle">No opt-out or re-consent events have been recorded yet.</p>}
        </div>
      </aside>
    </div>
  );
}
