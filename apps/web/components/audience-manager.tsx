"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type ListOption = { id: string; name: string; memberCount: number };
type Filter =
  | { field: "list"; operator: "in"; value: string }
  | { field: "display_name"; operator: "contains" | "starts_with" | "equals" | "is_empty"; value?: string }
  | { field: "phone_e164"; operator: "starts_with" | "ends_with" | "equals"; value: string };

type Preview = {
  count: number;
  sample: Array<{ id: string; displayName: string | null; phoneE164: string }>;
};

function defaultFilter(lists: ListOption[]): Filter {
  return lists[0]
    ? { field: "list", operator: "in", value: lists[0].id }
    : { field: "display_name", operator: "contains", value: "" };
}

export function AudienceManager({ lists }: { lists: ListOption[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [match, setMatch] = useState<"all" | "any">("all");
  const [filters, setFilters] = useState<Filter[]>([defaultFilter(lists)]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "save" | null>(null);

  const valid = useMemo(() => filters.every((filter) => {
    if (filter.field === "list") return Boolean(filter.value);
    if (filter.field === "display_name" && filter.operator === "is_empty") return true;
    return Boolean(filter.value?.trim());
  }), [filters]);

  const setField = (index: number, field: Filter["field"]) => {
    setFilters((current) => current.map((filter, position) => position !== index ? filter : (
      field === "list"
        ? { field: "list", operator: "in", value: lists[0]?.id ?? "" }
        : field === "display_name"
          ? { field: "display_name", operator: "contains", value: "" }
          : { field: "phone_e164", operator: "starts_with", value: "+" }
    )));
    setPreview(null);
  };

  const updateFilter = (index: number, patch: Record<string, string>) => {
    setFilters((current) => current.map((filter, position) => position === index ? ({ ...filter, ...patch } as Filter) : filter));
    setPreview(null);
  };

  const previewAudience = async (): Promise<Preview | null> => {
    if (!valid) return setMessage("Complete every filter before previewing."), null;
    setBusy("preview");
    setMessage(null);
    try {
      const response = await fetch("/api/audiences/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ match, filters }),
      });
      const result = (await response.json()) as Preview & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not preview audience");
      setPreview(result);
      return result;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not preview audience");
      return null;
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!name.trim()) return setMessage("Give this segment a name.");
    if (!valid) return setMessage("Complete every filter before saving.");
    setBusy("save");
    setMessage(null);
    try {
      const response = await fetch("/api/audiences/segments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          definition: { match, filters },
        }),
      });
      const result = (await response.json()) as { id?: string; error?: string };
      if (!response.ok || !result.id) throw new Error(result.error ?? "Could not save segment");
      setMessage("Segment saved. Campaigns can use it immediately.");
      setName("");
      setDescription("");
      setPreview(null);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save segment");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) minmax(260px, 1.5fr) 180px", gap: 12 }}>
        <label style={{ display: "grid", gap: 7, fontSize: 13, fontWeight: 700 }}>
          Segment name
          <input maxLength={120} onChange={(event) => setName(event.target.value)} placeholder="Baghdad VIPs" value={name} />
        </label>
        <label style={{ display: "grid", gap: 7, fontSize: 13, fontWeight: 700 }}>
          Description <span style={{ fontWeight: 400, color: "var(--muted)" }}>(optional)</span>
          <input maxLength={500} onChange={(event) => setDescription(event.target.value)} placeholder="Reusable campaign audience" value={description} />
        </label>
        <label style={{ display: "grid", gap: 7, fontSize: 13, fontWeight: 700 }}>
          Match
          <select onChange={(event) => { setMatch(event.target.value as "all" | "any"); setPreview(null); }} value={match}>
            <option value="all">All filters (AND)</option>
            <option value="any">Any filter (OR)</option>
          </select>
        </label>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {filters.map((filter, index) => (
          <div key={index} style={{ display: "grid", gridTemplateColumns: "180px 190px minmax(220px, 1fr) auto", gap: 10, alignItems: "center" }}>
            <select onChange={(event) => setField(index, event.target.value as Filter["field"])} value={filter.field}>
              <option value="list">List membership</option>
              <option value="display_name">Contact name</option>
              <option value="phone_e164">Phone number</option>
            </select>

            {filter.field === "list" ? (
              <select disabled value="in"><option value="in">is in list</option></select>
            ) : filter.field === "display_name" ? (
              <select onChange={(event) => updateFilter(index, { operator: event.target.value })} value={filter.operator}>
                <option value="contains">contains</option>
                <option value="starts_with">starts with</option>
                <option value="equals">equals</option>
                <option value="is_empty">is empty</option>
              </select>
            ) : (
              <select onChange={(event) => updateFilter(index, { operator: event.target.value })} value={filter.operator}>
                <option value="starts_with">starts with</option>
                <option value="ends_with">ends with</option>
                <option value="equals">equals</option>
              </select>
            )}

            {filter.field === "list" ? (
              <select onChange={(event) => updateFilter(index, { value: event.target.value })} value={filter.value}>
                {lists.length ? lists.map((list) => <option key={list.id} value={list.id}>{list.name} · {list.memberCount.toLocaleString()}</option>) : <option value="">No lists yet</option>}
              </select>
            ) : filter.field === "display_name" && filter.operator === "is_empty" ? (
              <span className="subtitle">No value required</span>
            ) : (
              <input onChange={(event) => updateFilter(index, { value: event.target.value })} placeholder={filter.field === "phone_e164" ? "+964" : "Value"} value={filter.value ?? ""} />
            )}

            <button className="secondary" disabled={filters.length === 1} onClick={() => { setFilters((current) => current.filter((_, position) => position !== index)); setPreview(null); }} type="button">Remove</button>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button className="secondary" disabled={filters.length >= 20} onClick={() => setFilters((current) => [...current, defaultFilter(lists)])} type="button">Add filter</button>
        <button className="secondary" disabled={busy !== null || !valid} onClick={() => void previewAudience()} type="button">{busy === "preview" ? "Previewing…" : "Preview audience"}</button>
        <button className="primary" disabled={busy !== null || !valid || !name.trim()} onClick={() => void save()} type="button">{busy === "save" ? "Saving…" : "Save segment"}</button>
        {message ? <span className="subtitle">{message}</span> : null}
      </div>

      {preview ? (
        <div className="numberRow" style={{ alignItems: "start" }}>
          <div>
            <strong>{preview.count.toLocaleString()} eligible contacts</strong>
            <p>Opt-out and suppression safety is applied before this count.</p>
          </div>
          <div className="numberMeta" style={{ alignItems: "flex-start" }}>
            {preview.sample.slice(0, 5).map((contact) => <span key={contact.id}>{contact.displayName ?? "Unnamed"} · {contact.phoneE164}</span>)}
          </div>
        </div>
      ) : null}
    </div>
  );
}
