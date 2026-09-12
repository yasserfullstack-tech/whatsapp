"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type WabaOption = { wabaId: string; label: string };

type Props = { wabas: WabaOption[] };

export function TemplateManager({ wabas }: Props) {
  const router = useRouter();
  const [wabaId, setWabaId] = useState(wabas[0]?.wabaId ?? "");
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("en_US");
  const [category, setCategory] = useState<"marketing" | "utility">("marketing");
  const [body, setBody] = useState("");
  const [footer, setFooter] = useState("");
  const [examplesText, setExamplesText] = useState("");
  const [busy, setBusy] = useState<"sync" | "create" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const variableCount = useMemo(() => {
    const indexes = [...body.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));
    return new Set(indexes).size;
  }, [body]);

  const syncTemplates = async () => {
    setBusy("sync");
    setMessage(null);
    try {
      const response = await fetch("/api/templates/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(wabaId ? { wabaId } : {}),
      });
      const result = (await response.json()) as { synced?: number; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Template sync failed");
      setMessage(`Synced ${result.synced ?? 0} template${result.synced === 1 ? "" : "s"} from Meta.`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Template sync failed");
    } finally {
      setBusy(null);
    }
  };

  const createTemplate = async () => {
    setBusy("create");
    setMessage(null);
    const examples = examplesText.split("\n").map((value) => value.trim()).filter(Boolean);

    try {
      const response = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wabaId, name, language, category, body, footer: footer || undefined, examples }),
      });
      const result = (await response.json()) as { status?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Template creation failed");
      setMessage(`Template submitted to Meta with status ${result.status ?? "PENDING"}.`);
      setName("");
      setBody("");
      setFooter("");
      setExamplesText("");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Template creation failed");
    } finally {
      setBusy(null);
    }
  };

  if (!wabas.length) {
    return <p className="subtitle">Connect a WhatsApp Business Account before syncing or creating templates.</p>;
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
        <label style={{ display: "grid", gap: 7, minWidth: 280, fontSize: 13, fontWeight: 700 }}>
          WhatsApp Business Account
          <select value={wabaId} onChange={(event) => setWabaId(event.target.value)}>
            {wabas.map((waba) => <option key={waba.wabaId} value={waba.wabaId}>{waba.label}</option>)}
          </select>
        </label>
        <button className="secondary" disabled={busy !== null} onClick={syncTemplates} type="button">
          {busy === "sync" ? "Syncing…" : "Sync from Meta"}
        </button>
      </div>

      <div style={{ borderTop: "1px solid var(--line)", paddingTop: 20, display: "grid", gap: 14 }}>
        <div>
          <p className="eyebrow">Create template</p>
          <h2>Submit a text template for review</h2>
          <p className="subtitle">Use positional variables such as <code>{"{{1}}"}</code>. Add one example value per variable so Meta can review the template.</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) 150px 160px", gap: 12 }}>
          <label style={{ display: "grid", gap: 7, fontSize: 13, fontWeight: 700 }}>
            Template name
            <input value={name} onChange={(event) => setName(event.target.value.toLowerCase().replace(/[^a-z0-9_]+/g, "_"))} placeholder="september_offer" />
          </label>
          <label style={{ display: "grid", gap: 7, fontSize: 13, fontWeight: 700 }}>
            Language
            <input value={language} onChange={(event) => setLanguage(event.target.value)} placeholder="en_US" />
          </label>
          <label style={{ display: "grid", gap: 7, fontSize: 13, fontWeight: 700 }}>
            Category
            <select value={category} onChange={(event) => setCategory(event.target.value as "marketing" | "utility")}>
              <option value="marketing">Marketing</option>
              <option value="utility">Utility</option>
            </select>
          </label>
        </div>

        <label style={{ display: "grid", gap: 7, fontSize: 13, fontWeight: 700 }}>
          Body · {body.length}/1024
          <textarea rows={6} maxLength={1024} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Hi {{1}}, our September offer is ready for you." />
        </label>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label style={{ display: "grid", gap: 7, fontSize: 13, fontWeight: 700 }}>
            Footer · optional
            <input maxLength={60} value={footer} onChange={(event) => setFooter(event.target.value)} placeholder="Reply STOP to opt out" />
          </label>
          <label style={{ display: "grid", gap: 7, fontSize: 13, fontWeight: 700 }}>
            Example values · one per line {variableCount ? `(${variableCount} required)` : ""}
            <textarea rows={3} value={examplesText} onChange={(event) => setExamplesText(event.target.value)} placeholder={variableCount ? "Yasser\n20% off" : "No examples needed without variables"} />
          </label>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button className="primary" disabled={busy !== null || !wabaId || !name || !body} onClick={createTemplate} type="button">
            {busy === "create" ? "Submitting…" : "Submit to Meta"}
          </button>
          {message ? <span style={{ color: "var(--muted)", fontSize: 13 }}>{message}</span> : null}
        </div>
      </div>
    </div>
  );
}
