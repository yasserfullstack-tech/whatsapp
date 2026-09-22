"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/i18n-provider";
import { getContactManagementCopy, type ContactManagementCopy } from "@/lib/contact-management-copy";

type ImportSnapshot = { id: string; fileName: string; status: "awaiting_upload" | "queued" | "processing" | "completed" | "failed"; totalRows: number; processedRows: number; importedRows: number; invalidRows: number; duplicateRows: number; errorMessage: string | null };
type PresignResponse = { importId: string; uploadUrl: string; contentType: "text/csv" };
const MAX_CSV_BYTES = 250 * 1024 * 1024;
const activeStatuses = new Set(["queued", "processing"]);
const PHONE_COLUMNS = ["phone", "phone_number", "mobile", "mobile_number", "whatsapp", "whatsapp_number"];
const NAME_COLUMNS = ["name", "full_name", "customer_name", "display_name"];

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function parseCsvHeader(text: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { current += '"'; index += 1; }
      else quoted = !quoted;
      continue;
    }
    if (!quoted && character === ",") { values.push(current.trim()); current = ""; continue; }
    if (!quoted && (character === "\n" || character === "\r")) break;
    current += character;
  }
  values.push(current.trim());
  return values.map((value, index) => index === 0 ? value.replace(/^\uFEFF/, "") : value).filter(Boolean).slice(0, 100);
}

function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

function parseCustomFieldMappings(value: string, headers: string[], copy: ContactManagementCopy): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const separator = line.indexOf("=");
    if (separator < 1) throw new Error(interpolate(copy.invalidMapping, { line }));
    const key = line.slice(0, separator).trim();
    const column = line.slice(separator + 1).trim();
    if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,39}$/.test(key)) throw new Error(interpolate(copy.invalidMappingKey, { key }));
    if (!headers.includes(column)) throw new Error(interpolate(copy.columnNotFound, { column }));
    result[key] = column;
  }
  if (Object.keys(result).length > 10) throw new Error(copy.tooManyMappings);
  return result;
}

export function ContactImporter({ initialImport }: { initialImport: ImportSnapshot | null }) {
  const router = useRouter();
  const { messages, number, format, locale } = useI18n();
  const copy = getContactManagementCopy(locale);
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [phoneColumn, setPhoneColumn] = useState("");
  const [displayNameColumn, setDisplayNameColumn] = useState("");
  const [customFieldMappings, setCustomFieldMappings] = useState("");
  const [country, setCountry] = useState("IQ");
  const [source, setSource] = useState(copy.defaultOptInSource);
  const [listName, setListName] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [snapshot, setSnapshot] = useState<ImportSnapshot | null>(initialImport);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!snapshot || !activeStatuses.has(snapshot.status)) return;
    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/contact-imports/${snapshot.id}`, { cache: "no-store" });
      if (!response.ok) return;
      const next = (await response.json()) as ImportSnapshot;
      setSnapshot(next);
      if (!activeStatuses.has(next.status)) router.refresh();
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [snapshot?.id, snapshot?.status, router]);

  const chooseFile = async (next: File | null) => {
    setFile(next); setHeaders([]); setPhoneColumn(""); setDisplayNameColumn(""); setCustomFieldMappings(""); setError(null);
    if (!next) return;
    try {
      const headerText = await next.slice(0, 64 * 1024).text();
      const parsedHeaders = parseCsvHeader(headerText);
      if (!parsedHeaders.length) throw new Error(copy.emptyCsvHeader);
      setHeaders(parsedHeaders);
      const normalized = new Map(parsedHeaders.map((header) => [normalizeHeader(header), header]));
      setPhoneColumn(PHONE_COLUMNS.map((candidate) => normalized.get(candidate)).find(Boolean) ?? parsedHeaders[0]!);
      setDisplayNameColumn(NAME_COLUMNS.map((candidate) => normalized.get(candidate)).find(Boolean) ?? "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.csvHeaderReadFailed);
    }
  };

  const startImport = async () => {
    if (!file) return setError(messages.ui.chooseCsv);
    if (!file.name.toLowerCase().endsWith(".csv")) return setError(messages.ui.csvOnly);
    if (file.size > MAX_CSV_BYTES) return setError(messages.ui.csvTooLarge);
    if (!/^[A-Za-z]{2}$/.test(country)) return setError(messages.ui.invalidCountry);
    if (listName.trim() && listName.trim().length < 2) return setError(messages.ui.listNameTooShort);
    if (!confirmed) return setError(messages.ui.confirmOptInFirst);
    if (!phoneColumn || !headers.includes(phoneColumn)) return setError(copy.choosePhoneColumn);
    setBusy(true); setError(null);
    try {
      const mappedCustomFields = parseCustomFieldMappings(customFieldMappings, headers, copy);
      const presignResponse = await fetch("/api/contact-imports/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          sizeBytes: file.size,
          defaultCountry: country,
          optInSource: source,
          ...(listName.trim() ? { listName: listName.trim() } : {}),
          confirmedOptIn: true,
          mapping: {
            phoneColumn,
            ...(displayNameColumn ? { displayNameColumn } : {}),
            customFields: mappedCustomFields,
          },
        }),
      });
      const presign = (await presignResponse.json()) as PresignResponse & { error?: string };
      if (!presignResponse.ok) throw new Error(presign.error ?? messages.ui.prepareUploadFailed);
      const uploadResponse = await fetch(presign.uploadUrl, { method: "PUT", headers: { "Content-Type": presign.contentType }, body: file });
      if (!uploadResponse.ok) throw new Error(messages.ui.r2Rejected);
      const queueResponse = await fetch(`/api/contact-imports/${presign.importId}`, { method: "POST" });
      const queued = (await queueResponse.json()) as ImportSnapshot & { error?: string };
      if (!queueResponse.ok) throw new Error(queued.error ?? messages.ui.queueImportFailed);
      setSnapshot(queued); setFile(null); setHeaders([]); setPhoneColumn(""); setDisplayNameColumn(""); setCustomFieldMappings(""); setConfirmed(false); router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : messages.ui.importStartFailed); }
    finally { setBusy(false); }
  };

  return <div style={{ display: "grid", gap: 18 }}>
    <div className="formGrid4">
      <label className="formLabel">{messages.ui.customerCsv}<input accept=".csv,text/csv" disabled={busy} onChange={(event) => void chooseFile(event.target.files?.[0] ?? null)} type="file" /></label>
      <label className="formLabel">{messages.ui.country}<input disabled={busy} maxLength={2} onChange={(event) => setCountry(event.target.value.toUpperCase())} value={country} /></label>
      <label className="formLabel">{messages.ui.optInSource}<input disabled={busy} onChange={(event) => setSource(event.target.value)} value={source} /></label>
      <label className="formLabel">{messages.ui.addToList} <span className="subtitle">({messages.common.optional})</span><input disabled={busy} maxLength={120} onChange={(event) => setListName(event.target.value)} placeholder={messages.ui.vipCustomers} value={listName} /></label>
    </div>
    {headers.length ? <div className="panel" style={{ display: "grid", gap: 12 }}>
      <div><strong>{copy.importMappingTitle}</strong><p className="subtitle">{copy.importMappingDescription}</p></div>
      <div className="formGrid4">
        <label className="formLabel">{copy.phoneColumn}<select disabled={busy} onChange={(event) => setPhoneColumn(event.target.value)} value={phoneColumn}>{headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></label>
        <label className="formLabel">{copy.displayNameColumn}<select disabled={busy} onChange={(event) => setDisplayNameColumn(event.target.value)} value={displayNameColumn}><option value="">{copy.doNotImport}</option>{headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></label>
        <label className="formLabel" style={{ gridColumn: "span 2" }}>{copy.customFields}<textarea disabled={busy} onChange={(event) => setCustomFieldMappings(event.target.value)} placeholder={copy.mappingPlaceholder} rows={3} value={customFieldMappings} /></label>
      </div>
    </div> : null}
    <label className="confirmationRow"><input checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" /><span>{messages.ui.consentConfirmation}</span></label>
    <div className="actionRow"><button className="secondary" disabled={busy || !file || !confirmed || !phoneColumn} onClick={startImport} type="button">{busy ? messages.ui.uploading : messages.ui.uploadAndImport}</button><span className="subtitle">{messages.ui.importLimitHint}</span></div>
    {error ? <p className="formError">{error}</p> : null}
    {snapshot ? <div className="numberRow"><div><strong>{snapshot.fileName}</strong><p>{snapshot.status === "completed" ? format(messages.ui.newContactsImported, { count: number(snapshot.importedRows) }) : snapshot.status === "processing" ? format(messages.ui.rowsProcessed, { count: number(snapshot.processedRows) }) : snapshot.status === "failed" ? snapshot.errorMessage ?? messages.ui.importFailed : messages.ui.waitingWorker}</p></div><div className="numberMeta"><span>{format(messages.ui.invalidRows, { count: number(snapshot.invalidRows) })}</span><span>{format(messages.ui.duplicateRows, { count: number(snapshot.duplicateRows) })}</span><span className={snapshot.status === "completed" ? "status connected" : "status"}>{snapshot.status.replaceAll("_", " ")}</span></div></div> : null}
  </div>;
}
