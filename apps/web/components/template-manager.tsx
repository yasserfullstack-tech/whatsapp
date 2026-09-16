"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { TemplatePreview } from "@/components/template-preview";
import { useI18n } from "@/components/i18n-provider";

type WabaOption = { wabaId: string; label: string };
type HeaderType = "none" | "text" | "image" | "video" | "document";
type ButtonType = "QUICK_REPLY" | "URL" | "PHONE_NUMBER";
type ButtonDraft = { type: ButtonType; text: string; value: string; example: string };

function variableIndexes(text: string): number[] {
  return [...new Set([...text.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1])))]
    .filter((value) => Number.isInteger(value) && value > 0)
    .sort((a, b) => a - b);
}

export function TemplateManager({ wabas }: { wabas: WabaOption[] }) {
  const router = useRouter();
  const { messages, number, format } = useI18n();
  const [wabaId, setWabaId] = useState(wabas[0]?.wabaId ?? "");
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("en_US");
  const [category, setCategory] = useState<"marketing" | "utility">("marketing");
  const [headerType, setHeaderType] = useState<HeaderType>("none");
  const [headerText, setHeaderText] = useState("");
  const [headerExamplesText, setHeaderExamplesText] = useState("");
  const [mediaHandle, setMediaHandle] = useState("");
  const [body, setBody] = useState("");
  const [footer, setFooter] = useState("");
  const [examplesText, setExamplesText] = useState("");
  const [buttons, setButtons] = useState<ButtonDraft[]>([]);
  const [busy, setBusy] = useState<"sync" | "create" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const bodyVariables = useMemo(() => variableIndexes(body), [body]);
  const headerVariables = useMemo(() => variableIndexes(headerText), [headerText]);
  const bodyExamples = useMemo(() => examplesText.split("\n").map((value) => value.trim()).filter(Boolean), [examplesText]);
  const headerExamples = useMemo(() => headerExamplesText.split("\n").map((value) => value.trim()).filter(Boolean), [headerExamplesText]);

  const components = useMemo<Record<string, unknown>[]>(() => {
    const next: Record<string, unknown>[] = [];
    if (headerType === "text" && headerText.trim()) {
      next.push({
        type: "HEADER",
        format: "TEXT",
        text: headerText.trim(),
        ...(headerExamples.length ? { example: { header_text: headerExamples } } : {}),
      });
    } else if (headerType !== "none") {
      next.push({
        type: "HEADER",
        format: headerType.toUpperCase(),
        ...(mediaHandle.trim() ? { example: { header_handle: [mediaHandle.trim()] } } : {}),
      });
    }
    next.push({
      type: "BODY",
      text: body,
      ...(bodyExamples.length ? { example: { body_text: [bodyExamples] } } : {}),
    });
    if (footer.trim()) next.push({ type: "FOOTER", text: footer.trim() });
    if (buttons.length) {
      next.push({
        type: "BUTTONS",
        buttons: buttons.map((button) => ({
          type: button.type,
          text: button.text.trim(),
          ...(button.type === "URL" ? {
            url: button.value.trim(),
            ...(button.example.trim() ? { example: [button.example.trim()] } : {}),
          } : {}),
          ...(button.type === "PHONE_NUMBER" ? { phone_number: button.value.trim() } : {}),
        })),
      });
    }
    return next;
  }, [body, bodyExamples, buttons, footer, headerExamples, headerText, headerType, mediaHandle]);

  const creationValid = Boolean(
    wabaId &&
    name &&
    body.trim() &&
    bodyVariables.length === bodyExamples.length &&
    (headerType !== "text" || (headerText.trim() && headerVariables.length === headerExamples.length)) &&
    (headerType === "none" || headerType === "text" || mediaHandle.trim()) &&
    buttons.every((button) => button.text.trim() && (button.type === "QUICK_REPLY" || button.value.trim()))
  );

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
      if (!response.ok) throw new Error(result.error ?? messages.ui.templateSyncFailed);
      setMessage(format(messages.ui.templatesSynced, { count: number(result.synced ?? 0) }));
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : messages.ui.templateSyncFailed);
    } finally {
      setBusy(null);
    }
  };

  const createTemplate = async () => {
    if (!creationValid) return;
    setBusy("create");
    setMessage(null);
    try {
      const response = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wabaId, name, language, category, components }),
      });
      const result = (await response.json()) as { status?: string; error?: string; issues?: string[] };
      if (!response.ok) throw new Error(result.error ?? result.issues?.join(". ") ?? messages.ui.templateCreationFailed);
      setMessage(format(messages.ui.templateSubmitted, { status: result.status ?? "PENDING" }));
      setName("");
      setHeaderType("none");
      setHeaderText("");
      setHeaderExamplesText("");
      setMediaHandle("");
      setBody("");
      setFooter("");
      setExamplesText("");
      setButtons([]);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : messages.ui.templateCreationFailed);
    } finally {
      setBusy(null);
    }
  };

  const addButton = () => setButtons((current) => current.length >= 3
    ? current
    : [...current, { type: "QUICK_REPLY", text: "", value: "", example: "" }]);
  const updateButton = (index: number, patch: Partial<ButtonDraft>) => setButtons((current) => current.map((button, offset) => offset === index ? { ...button, ...patch } : button));
  const removeButton = (index: number) => setButtons((current) => current.filter((_, offset) => offset !== index));

  if (!wabas.length) return <p className="subtitle">{messages.ui.connectWabaFirst}</p>;

  return <div style={{ display: "grid", gap: 20 }}>
    <div className="actionRow">
      <label className="formLabel" style={{ minWidth: 280, flex: "1 1 280px" }}>{messages.ui.waba}
        <select value={wabaId} onChange={(event) => setWabaId(event.target.value)}>{wabas.map((waba) => <option key={waba.wabaId} value={waba.wabaId}>{waba.label}</option>)}</select>
      </label>
      <button className="secondary" disabled={busy !== null} onClick={syncTemplates} type="button">{busy === "sync" ? messages.ui.syncing : messages.ui.syncFromMeta}</button>
    </div>

    <div style={{ borderTop: "1px solid var(--line)", paddingTop: 20, display: "grid", gap: 14 }}>
      <div><p className="eyebrow">{messages.ui.createTemplate}</p><h2>Submit rich WhatsApp template</h2><p className="subtitle">Headers, media, buttons, and positional variables are stored exactly as Meta components.</p></div>
      <div className="formGrid3">
        <label className="formLabel">{messages.ui.templateName}<input value={name} onChange={(event) => setName(event.target.value.toLowerCase().replace(/[^a-z0-9_]+/g, "_"))} placeholder="september_offer" /></label>
        <label className="formLabel">{messages.ui.languageLabel}<input value={language} onChange={(event) => setLanguage(event.target.value)} placeholder="en_US" /></label>
        <label className="formLabel">{messages.ui.category}<select value={category} onChange={(event) => setCategory(event.target.value as "marketing" | "utility")}><option value="marketing">{messages.ui.marketing}</option><option value="utility">{messages.ui.utility}</option></select></label>
      </div>

      <div className="formGrid2">
        <label className="formLabel">Header type
          <select value={headerType} onChange={(event) => setHeaderType(event.target.value as HeaderType)}>
            <option value="none">None</option><option value="text">Text</option><option value="image">Image</option><option value="video">Video</option><option value="document">Document</option>
          </select>
        </label>
        {headerType === "text" ? <label className="formLabel">Header text<input maxLength={60} value={headerText} onChange={(event) => setHeaderText(event.target.value)} placeholder="Our {{1}} is on!" /></label> : headerType !== "none" ? <label className="formLabel">Meta media handle for review<input value={mediaHandle} onChange={(event) => setMediaHandle(event.target.value)} placeholder="4::..." /></label> : <div />}
      </div>
      {headerType === "text" && headerVariables.length ? <label className="formLabel">Header example values · {headerVariables.length} required<textarea rows={2} value={headerExamplesText} onChange={(event) => setHeaderExamplesText(event.target.value)} placeholder="Summer Sale" /></label> : null}

      <label className="formLabel">{messages.ui.body} · {body.length}/1024<textarea rows={6} maxLength={1024} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Hi {{1}}, your order {{2}} is ready." /></label>
      <div className="formGrid2">
        <label className="formLabel">{messages.ui.footerOptional}<input maxLength={60} value={footer} onChange={(event) => setFooter(event.target.value)} placeholder={messages.ui.footerPlaceholder} /></label>
        <label className="formLabel">{messages.ui.exampleValues} {bodyVariables.length ? format(messages.ui.examplesRequired, { count: number(bodyVariables.length) }) : ""}<textarea rows={3} value={examplesText} onChange={(event) => setExamplesText(event.target.value)} placeholder={bodyVariables.length ? "Yasser\nORD-42" : messages.ui.noExamplesNeeded} /></label>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <div className="actionRow"><strong>Buttons</strong><button className="secondary" type="button" onClick={addButton} disabled={buttons.length >= 3}>Add button</button></div>
        {buttons.map((button, index) => <div className="bindingRow" key={index}>
          <select value={button.type} onChange={(event) => updateButton(index, { type: event.target.value as ButtonType, value: "", example: "" })}>
            <option value="QUICK_REPLY">Quick reply</option><option value="URL">URL</option><option value="PHONE_NUMBER">Phone</option>
          </select>
          <input value={button.text} onChange={(event) => updateButton(index, { text: event.target.value })} placeholder="Button label" maxLength={25} />
          {button.type === "URL" ? <input value={button.value} onChange={(event) => updateButton(index, { value: event.target.value })} placeholder="https://example.com/{{1}}" /> : button.type === "PHONE_NUMBER" ? <input value={button.value} onChange={(event) => updateButton(index, { value: event.target.value })} placeholder="+15550001111" /> : <span className="subtitle">Payload is mapped per campaign.</span>}
          {button.type === "URL" && variableIndexes(button.value).length ? <input value={button.example} onChange={(event) => updateButton(index, { example: event.target.value })} placeholder="Meta URL example value" /> : null}
          <button className="secondary" type="button" onClick={() => removeButton(index)}>Remove</button>
        </div>)}
      </div>

      <div><p className="eyebrow">{messages.ui.templatePreview}</p><TemplatePreview components={components} /></div>
      <div className="actionRow"><button className="primary" disabled={busy !== null || !creationValid} onClick={createTemplate} type="button">{busy === "create" ? messages.ui.submitting : messages.ui.submitToMeta}</button>{message ? <span className="subtitle">{message}</span> : null}</div>
    </div>
  </div>;
}
