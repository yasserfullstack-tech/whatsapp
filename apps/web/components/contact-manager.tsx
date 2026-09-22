"use client";

import { useEffect, useState } from "react";
import { ContactResubscribeForm } from "@/components/contact-resubscribe-form";
import { useI18n } from "@/components/i18n-provider";
import { getContactManagementCopy } from "@/lib/contact-management-copy";

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
  tags: string[];
  customFields: Record<string, string>;
  noteCount: number;
};
type ActivityRow = { id: string; contactId: string | null; eventType: string; metadata: Record<string, unknown>; occurredAt: string; phoneE164: string | null; displayName: string | null };
type ContactsResponse = { contacts: ContactRow[]; nextCursor: string | null; activities: ActivityRow[]; error?: string };
type ContactDetail = { notes: Array<{ id: string; body: string; createdAt: string }>; activities: Array<{ id: string; eventType: string; occurredAt: string; metadata: Record<string, unknown> }> };
type DuplicateGroup = { duplicate_key: string; contacts: Array<{ id: string; phoneE164: string; displayName: string | null }> };

type Props = {
  canManage: boolean;
  canResubscribe: boolean;
  initialQuery?: string;
  initialStatus?: string;
};

function fieldsToText(fields: Record<string, string>): string {
  return Object.entries(fields).map(([key, value]) => `${key}=${value}`).join("\n");
}

function tagsFromText(value: string): string[] {
  return [...new Set(value.split(",").map((tag) => tag.trim()).filter(Boolean))];
}

export function ContactManager({ canManage, canResubscribe, initialQuery = "", initialStatus = "all" }: Props) {
  const { messages, locale, format, dateTime } = useI18n();
  const copy = getContactManagementCopy(locale);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [query, setQuery] = useState(initialQuery);
  const [status, setStatus] = useState(initialStatus);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [newPhone, setNewPhone] = useState("");
  const [newName, setNewName] = useState("");
  const [newTags, setNewTags] = useState("");
  const [newFields, setNewFields] = useState("");
  const [newNote, setNewNote] = useState("");

  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editTags, setEditTags] = useState("");
  const [editFields, setEditFields] = useState("");
  const [editNote, setEditNote] = useState("");
  const [detail, setDetail] = useState<ContactDetail | null>(null);

  const [bulkAction, setBulkAction] = useState<"add_tag" | "remove_tag" | "suppress">("add_tag");
  const [bulkValue, setBulkValue] = useState("");
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [duplicateTargets, setDuplicateTargets] = useState<Record<string, string>>({});
  const [suppressionContactId, setSuppressionContactId] = useState<string | null>(null);
  const [suppressionReason, setSuppressionReason] = useState(messages.ui.defaultSuppressionReason);
  const [resubscribeContactId, setResubscribeContactId] = useState<string | null>(null);

  const textToFields = (value: string): Record<string, string> => {
    const fields: Record<string, string> = {};
    for (const rawLine of value.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const separator = line.indexOf("=");
      if (separator < 1) throw new Error(format(copy.invalidCustomField, { line }));
      const key = line.slice(0, separator).trim();
      const fieldValue = line.slice(separator + 1).trim();
      if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,39}$/.test(key)) throw new Error(format(copy.invalidCustomFieldKey, { key }));
      fields[key] = fieldValue;
    }
    return fields;
  };

  const loadContacts = async (reset: boolean, override?: { query?: string; status?: string }) => {
    setBusy(true); setError(null);
    try {
      const resolvedQuery = override?.query ?? query;
      const resolvedStatus = override?.status ?? status;
      const params = new URLSearchParams({ limit: "50", status: resolvedStatus });
      if (resolvedQuery.trim()) params.set("q", resolvedQuery.trim());
      if (!reset && nextCursor) params.set("cursor", nextCursor);
      const response = await fetch(`/api/contacts?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json() as ContactsResponse;
      if (!response.ok) throw new Error(payload.error ?? copy.loadFailed);
      setContacts((current) => reset ? payload.contacts : [...current, ...payload.contacts]);
      setNextCursor(payload.nextCursor);
      if (reset) { setActivities(payload.activities); setSelected([]); }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.loadFailed);
    } finally { setBusy(false); }
  };

  useEffect(() => { void loadContacts(true, { query: initialQuery, status: initialStatus }); }, []);

  const applyFilters = (nextQuery = query, nextStatus = status) => {
    const params = new URLSearchParams();
    if (nextQuery.trim()) params.set("q", nextQuery.trim());
    if (nextStatus !== "all") params.set("status", nextStatus);
    const nextUrl = params.size ? `/contacts?${params.toString()}` : "/contacts";
    window.history.replaceState(null, "", nextUrl);
    void loadContacts(true, { query: nextQuery, status: nextStatus });
  };

  const createContact = async () => {
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await fetch("/api/contacts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneE164: newPhone, displayName: newName || null, tags: tagsFromText(newTags), customFields: textToFields(newFields), ...(newNote.trim() ? { note: newNote.trim() } : {}) }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? copy.createFailed);
      setNewPhone(""); setNewName(""); setNewTags(""); setNewFields(""); setNewNote(""); setMessage(copy.created);
      await loadContacts(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : copy.createFailed); }
    finally { setBusy(false); }
  };

  const openEditor = async (contact: ContactRow) => {
    setEditId(contact.id); setEditName(contact.displayName ?? ""); setEditTags(contact.tags.join(", ")); setEditFields(fieldsToText(contact.customFields)); setEditNote(""); setDetail(null); setError(null);
    const response = await fetch(`/api/contacts/${contact.id}`, { cache: "no-store" });
    if (response.ok) setDetail(await response.json() as ContactDetail);
  };

  const saveContact = async () => {
    if (!editId) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await fetch(`/api/contacts/${editId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: editName || null, tags: tagsFromText(editTags), customFields: textToFields(editFields), ...(editNote.trim() ? { note: editNote.trim() } : {}) }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? copy.updateFailed);
      setMessage(copy.updated); setEditId(null); setDetail(null); await loadContacts(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : copy.updateFailed); }
    finally { setBusy(false); }
  };

  const suppressContact = async () => {
    if (!suppressionContactId) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await fetch(`/api/contacts/${suppressionContactId}/suppress`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: suppressionReason }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? messages.ui.suppressFailed);
      setMessage(copy.suppressedMessage); setSuppressionContactId(null); setSuppressionReason(messages.ui.defaultSuppressionReason); await loadContacts(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : messages.ui.suppressFailed); }
    finally { setBusy(false); }
  };

  const runBulkAction = async () => {
    if (!selected.length) return setError(copy.selectOne);
    if (bulkAction === "suppress" && !window.confirm(format(copy.bulkSuppressConfirm, { count: selected.length }))) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await fetch("/api/contacts/bulk", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactIds: selected, action: bulkAction, ...(bulkAction === "suppress" ? { reason: bulkValue.trim() || copy.bulkSuppressionReason } : { tag: bulkValue.trim() }) }),
      });
      const payload = await response.json() as { error?: string; affected?: number };
      if (!response.ok) throw new Error(payload.error ?? copy.bulkFailed);
      setMessage(format(copy.bulkCompleted, { count: payload.affected ?? selected.length })); setSelected([]); await loadContacts(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : copy.bulkFailed); }
    finally { setBusy(false); }
  };

  const findDuplicates = async () => {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/contacts?duplicates=1", { cache: "no-store" });
      const payload = await response.json() as { groups?: DuplicateGroup[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? copy.duplicateScanFailed);
      const groups = payload.groups ?? [];
      setDuplicateGroups(groups);
      setDuplicateTargets(Object.fromEntries(groups.map((group) => [group.duplicate_key, group.contacts[0]?.id ?? ""])));
      if (!groups.length) setMessage(copy.noDuplicates);
    } catch (caught) { setError(caught instanceof Error ? caught.message : copy.duplicateScanFailed); }
    finally { setBusy(false); }
  };

  const mergeGroup = async (group: DuplicateGroup) => {
    const targetContactId = duplicateTargets[group.duplicate_key];
    if (!targetContactId) return;
    const sourceContactIds = group.contacts.map((contact) => contact.id).filter((id) => id !== targetContactId);
    if (!sourceContactIds.length) return;
    if (!window.confirm(format(copy.mergeConfirm, { count: sourceContactIds.length }))) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await fetch("/api/contacts/merge", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetContactId, sourceContactIds, reason: copy.duplicateReviewReason }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? copy.mergeFailed);
      setMessage(copy.merged);
      await findDuplicates(); await loadContacts(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : copy.mergeFailed); }
    finally { setBusy(false); }
  };

  const toggleSelected = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const suppressionContact = contacts.find((contact) => contact.id === suppressionContactId) ?? null;

  return <div style={{ display: "grid", gap: 20 }}>
    {canManage ? <section className="panel" style={{ display: "grid", gap: 14 }}>
      <div><strong>{copy.createTitle}</strong><p className="subtitle">{copy.createDescription}</p></div>
      <div className="formGrid4">
        <label className="formLabel">{copy.phoneE164}<input placeholder="+15551234567" value={newPhone} onChange={(event) => setNewPhone(event.target.value)} /></label>
        <label className="formLabel">{copy.displayName}<input maxLength={160} value={newName} onChange={(event) => setNewName(event.target.value)} /></label>
        <label className="formLabel">{copy.tags}<input value={newTags} onChange={(event) => setNewTags(event.target.value)} /></label>
        <label className="formLabel">{copy.note}<input maxLength={4000} value={newNote} onChange={(event) => setNewNote(event.target.value)} /></label>
      </div>
      <label className="formLabel">{copy.customFields} <span className="subtitle">({copy.keyValueHint})</span><textarea rows={3} value={newFields} onChange={(event) => setNewFields(event.target.value)} /></label>
      <div><button className="primary" disabled={busy || !newPhone.trim()} type="button" onClick={() => void createContact()}>{copy.createContact}</button></div>
    </section> : null}

    <section className="panel" style={{ display: "grid", gap: 14 }}>
      <form className="contactFilters" onSubmit={(event) => { event.preventDefault(); applyFilters(); }}>
        <label><span>{messages.ui.search}</span><input name="q" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={messages.ui.searchPlaceholder} /></label>
        <label><span>{messages.ui.status}</span><select name="status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">{messages.ui.allContacts}</option><option value="eligible">{messages.ui.eligible}</option><option value="suppressed">{messages.ui.suppressed}</option><option value="not_eligible">{messages.ui.needsConsent}</option></select></label>
        <button className="primary" disabled={busy} type="submit">{messages.ui.applyFilters}</button>
        <button className="secondary" disabled={busy} type="button" onClick={() => { setQuery(""); setStatus("all"); applyFilters("", "all"); }}>{messages.ui.clear}</button>
      </form>
      {canManage ? <div className="actionRow">
        <strong>{format(copy.selected, { count: selected.length })}</strong>
        <select value={bulkAction} onChange={(event) => setBulkAction(event.target.value as typeof bulkAction)}><option value="add_tag">{copy.addTag}</option><option value="remove_tag">{copy.removeTag}</option><option value="suppress">{messages.ui.suppress}</option></select>
        <input placeholder={bulkAction === "suppress" ? copy.suppressionReasonOptional : copy.tag} value={bulkValue} onChange={(event) => setBulkValue(event.target.value)} />
        <button className="secondary" disabled={busy || !selected.length || (bulkAction !== "suppress" && !bulkValue.trim())} type="button" onClick={() => void runBulkAction()}>{copy.applyBulkAction}</button>
        <button className="secondary" disabled={busy} type="button" onClick={() => void findDuplicates()}>{copy.reviewDuplicates}</button>
      </div> : null}
      {suppressionContact ? <form className="consentActionForm" onSubmit={(event) => { event.preventDefault(); void suppressContact(); }}>
        <div><p className="eyebrow">{messages.ui.manualSuppression}</p><h3>{suppressionContact.displayName ?? suppressionContact.phoneE164}</h3><p className="subtitle">{messages.ui.suppressionDescription}</p></div>
        <label><span>{messages.ui.reason}</span><textarea name="reason" value={suppressionReason} onChange={(event) => setSuppressionReason(event.target.value)} minLength={3} maxLength={240} required /></label>
        <div className="formActions"><button className="primary" disabled={busy} type="submit">{busy ? messages.common.saving : messages.ui.suppressContact}</button><button className="secondary" disabled={busy} onClick={() => setSuppressionContactId(null)} type="button">{messages.common.cancel}</button></div>
      </form> : null}
      {error ? <p className="formError">{error}</p> : null}
      {message ? <p className="contactNotice" role="status">{message}</p> : null}
      <div style={{ overflowX: "auto" }}><table className="dataTable"><thead><tr>{canManage ? <th>{copy.select}</th> : null}<th>{copy.contact}</th><th>{copy.consent}</th><th>{copy.tags}</th><th>{copy.fields}</th><th>{copy.notes}</th><th>{copy.actions}</th></tr></thead><tbody>
        {contacts.map((contact) => {
          const eligible = contact.optedIn && !contact.unsubscribedAt && !contact.suppressedAt;
          const resubscribeOpen = resubscribeContactId === contact.id;
          return <tr className="contactRow" key={contact.id}>
            {canManage ? <td><input aria-label={copy.select} checked={selected.includes(contact.id)} onChange={() => toggleSelected(contact.id)} type="checkbox" /></td> : null}
            <td><strong>{contact.displayName || messages.ui.unnamedContact}</strong><br /><span className="subtitle">{contact.phoneE164}</span></td>
            <td><span className={contact.suppressedAt ? "status" : eligible ? "status connected" : "status"}>{contact.suppressedAt ? messages.ui.suppressed : eligible ? messages.ui.eligible : messages.ui.needsConsent}</span></td>
            <td>{contact.tags.length ? contact.tags.join(", ") : "—"}</td>
            <td>{Object.keys(contact.customFields).length ? Object.entries(contact.customFields).map(([key, value]) => `${key}: ${value}`).join(" · ") : "—"}</td>
            <td>{contact.noteCount}</td>
            <td><div className="actionRow">{canManage ? <><button className="secondary" disabled={busy} type="button" onClick={() => void openEditor(contact)}>{copy.edit}</button>{!contact.suppressedAt ? <button className="secondary" disabled={busy} type="button" onClick={() => { setSuppressionContactId(contact.id); setSuppressionReason(messages.ui.defaultSuppressionReason); }}>{messages.ui.suppress}</button> : null}</> : null}{canResubscribe && !eligible ? <><button className="textButton" type="button" aria-expanded={resubscribeOpen} onClick={() => setResubscribeContactId((current) => current === contact.id ? null : contact.id)}>{messages.ui.recordNewConsent}</button>{resubscribeOpen ? <ContactResubscribeForm contactId={contact.id} phoneE164={contact.phoneE164} displayName={contact.displayName} /> : null}</> : null}</div></td>
          </tr>;
        })}
        {!contacts.length && !busy ? <tr><td colSpan={canManage ? 7 : 6}>{copy.noContactsFilters}</td></tr> : null}
      </tbody></table></div>
      {nextCursor ? <div><button className="secondary" disabled={busy} type="button" onClick={() => void loadContacts(false)}>{busy ? messages.common.loading : copy.loadMore}</button></div> : null}
    </section>

    {editId && canManage ? <section className="panel" style={{ display: "grid", gap: 12 }}>
      <div className="actionRow"><strong>{copy.editContact}</strong><span className="subtitle">{copy.immutablePhone}</span></div>
      <div className="formGrid4"><label className="formLabel">{copy.displayName}<input value={editName} onChange={(event) => setEditName(event.target.value)} /></label><label className="formLabel">{copy.tags}<input value={editTags} onChange={(event) => setEditTags(event.target.value)} /></label><label className="formLabel">{copy.newNote}<input value={editNote} onChange={(event) => setEditNote(event.target.value)} /></label></div>
      <label className="formLabel">{copy.customFields}<textarea rows={4} value={editFields} onChange={(event) => setEditFields(event.target.value)} /></label>
      {detail?.notes.length ? <div><strong>{copy.recentNotes}</strong>{detail.notes.slice(0, 10).map((note) => <p className="subtitle" key={note.id}>{dateTime(note.createdAt)}: {note.body}</p>)}</div> : null}
      <div className="actionRow"><button className="primary" disabled={busy} type="button" onClick={() => void saveContact()}>{copy.saveChanges}</button><button className="secondary" type="button" onClick={() => { setEditId(null); setDetail(null); }}>{messages.common.cancel}</button></div>
    </section> : null}

    {duplicateGroups.length ? <section className="panel" style={{ display: "grid", gap: 14 }}><div><strong>{copy.duplicateCandidates}</strong><p className="subtitle">{copy.duplicateDescription}</p></div>{duplicateGroups.map((group) => <div className="numberRow" key={group.duplicate_key}><div><strong>{group.contacts[0]?.displayName ?? group.duplicate_key}</strong><p>{group.contacts.map((contact) => contact.phoneE164).join(" · ")}</p></div><div className="actionRow"><select aria-label={copy.mergeTarget} value={duplicateTargets[group.duplicate_key] ?? ""} onChange={(event) => setDuplicateTargets((current) => ({ ...current, [group.duplicate_key]: event.target.value }))}>{group.contacts.map((contact) => <option key={contact.id} value={contact.id}>{format(copy.keep, { phone: contact.phoneE164 })}</option>)}</select><button className="secondary" disabled={busy} type="button" onClick={() => void mergeGroup(group)}>{copy.mergeOthers}</button></div></div>)}</section> : null}

    {activities.length ? <section className="panel"><div><strong>{copy.activityTitle}</strong><p className="subtitle">{copy.activityDescription}</p></div><div style={{ display: "grid", gap: 8, marginTop: 12 }}>{activities.map((activity) => <div className="numberRow" key={activity.id}><div><strong>{activity.eventType}</strong><p>{activity.displayName || activity.phoneE164 || copy.contactFallback}</p></div><span className="subtitle">{dateTime(activity.occurredAt)}</span></div>)}</div></section> : null}
  </div>;
}
