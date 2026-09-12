"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/i18n-provider";

type ImportSnapshot = { id: string; fileName: string; status: "awaiting_upload" | "queued" | "processing" | "completed" | "failed"; totalRows: number; processedRows: number; importedRows: number; invalidRows: number; duplicateRows: number; errorMessage: string | null };
type PresignResponse = { importId: string; uploadUrl: string; contentType: "text/csv" };
const MAX_CSV_BYTES = 250 * 1024 * 1024;
const activeStatuses = new Set(["queued", "processing"]);

export function ContactImporter({ initialImport }: { initialImport: ImportSnapshot | null }) {
  const router = useRouter();
  const { messages, number, format } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [country, setCountry] = useState("IQ");
  const [source, setSource] = useState("customer database consent");
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

  const startImport = async () => {
    if (!file) return setError(messages.ui.chooseCsv);
    if (!file.name.toLowerCase().endsWith(".csv")) return setError(messages.ui.csvOnly);
    if (file.size > MAX_CSV_BYTES) return setError(messages.ui.csvTooLarge);
    if (!/^[A-Za-z]{2}$/.test(country)) return setError(messages.ui.invalidCountry);
    if (listName.trim() && listName.trim().length < 2) return setError(messages.ui.listNameTooShort);
    if (!confirmed) return setError(messages.ui.confirmOptInFirst);
    setBusy(true); setError(null);
    try {
      const presignResponse = await fetch("/api/contact-imports/presign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: file.name, sizeBytes: file.size, defaultCountry: country, optInSource: source, ...(listName.trim() ? { listName: listName.trim() } : {}), confirmedOptIn: true }) });
      const presign = (await presignResponse.json()) as PresignResponse & { error?: string };
      if (!presignResponse.ok) throw new Error(presign.error ?? messages.ui.prepareUploadFailed);
      const uploadResponse = await fetch(presign.uploadUrl, { method: "PUT", headers: { "Content-Type": presign.contentType }, body: file });
      if (!uploadResponse.ok) throw new Error(messages.ui.r2Rejected);
      const queueResponse = await fetch(`/api/contact-imports/${presign.importId}`, { method: "POST" });
      const queued = (await queueResponse.json()) as ImportSnapshot & { error?: string };
      if (!queueResponse.ok) throw new Error(queued.error ?? messages.ui.queueImportFailed);
      setSnapshot(queued); setFile(null); setConfirmed(false); router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : messages.ui.importStartFailed); }
    finally { setBusy(false); }
  };

  return <div style={{ display: "grid", gap: 18 }}>
    <div className="formGrid4">
      <label className="formLabel">{messages.ui.customerCsv}<input accept=".csv,text/csv" disabled={busy} onChange={(event) => setFile(event.target.files?.[0] ?? null)} type="file" /></label>
      <label className="formLabel">{messages.ui.country}<input disabled={busy} maxLength={2} onChange={(event) => setCountry(event.target.value.toUpperCase())} value={country} /></label>
      <label className="formLabel">{messages.ui.optInSource}<input disabled={busy} onChange={(event) => setSource(event.target.value)} value={source} /></label>
      <label className="formLabel">{messages.ui.addToList} <span className="subtitle">({messages.common.optional})</span><input disabled={busy} maxLength={120} onChange={(event) => setListName(event.target.value)} placeholder={messages.ui.vipCustomers} value={listName} /></label>
    </div>
    <label className="confirmationRow"><input checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" /><span>{messages.ui.consentConfirmation}</span></label>
    <div className="actionRow"><button className="secondary" disabled={busy || !file || !confirmed} onClick={startImport} type="button">{busy ? messages.ui.uploading : messages.ui.uploadAndImport}</button><span className="subtitle">{messages.ui.importLimitHint}</span></div>
    {error ? <p className="formError">{error}</p> : null}
    {snapshot ? <div className="numberRow"><div><strong>{snapshot.fileName}</strong><p>{snapshot.status === "completed" ? format(messages.ui.newContactsImported, { count: number(snapshot.importedRows) }) : snapshot.status === "processing" ? format(messages.ui.rowsProcessed, { count: number(snapshot.processedRows) }) : snapshot.status === "failed" ? snapshot.errorMessage ?? messages.ui.importFailed : messages.ui.waitingWorker}</p></div><div className="numberMeta"><span>{format(messages.ui.invalidRows, { count: number(snapshot.invalidRows) })}</span><span>{format(messages.ui.duplicateRows, { count: number(snapshot.duplicateRows) })}</span><span className={snapshot.status === "completed" ? "status connected" : "status"}>{snapshot.status.replaceAll("_", " ")}</span></div></div> : null}
  </div>;
}
