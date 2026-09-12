"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type ImportSnapshot = {
  id: string;
  fileName: string;
  status: "awaiting_upload" | "queued" | "processing" | "completed" | "failed";
  totalRows: number;
  processedRows: number;
  importedRows: number;
  invalidRows: number;
  duplicateRows: number;
  errorMessage: string | null;
};

type PresignResponse = {
  importId: string;
  uploadUrl: string;
  contentType: "text/csv";
};

const MAX_CSV_BYTES = 250 * 1024 * 1024;
const activeStatuses = new Set(["queued", "processing"]);

export function ContactImporter({ initialImport }: { initialImport: ImportSnapshot | null }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [country, setCountry] = useState("IQ");
  const [source, setSource] = useState("customer database consent");
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
    if (!file) return setError("Choose a CSV file first.");
    if (!file.name.toLowerCase().endsWith(".csv")) return setError("Only .csv files are supported.");
    if (file.size > MAX_CSV_BYTES) return setError("CSV files are limited to 250 MB.");
    if (!/^[A-Za-z]{2}$/.test(country)) return setError("Default country must be a two-letter code such as IQ, AE, or US.");
    if (!confirmed) return setError("Confirm that these customers agreed to receive WhatsApp marketing before importing.");

    setBusy(true);
    setError(null);

    try {
      const presignResponse = await fetch("/api/contact-imports/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          sizeBytes: file.size,
          defaultCountry: country,
          optInSource: source,
          confirmedOptIn: true,
        }),
      });

      const presign = (await presignResponse.json()) as PresignResponse & { error?: string };
      if (!presignResponse.ok) throw new Error(presign.error ?? "Could not prepare the upload");

      const uploadResponse = await fetch(presign.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": presign.contentType },
        body: file,
      });
      if (!uploadResponse.ok) throw new Error("R2 rejected the file upload. Check bucket CORS and try again.");

      const queueResponse = await fetch(`/api/contact-imports/${presign.importId}`, { method: "POST" });
      const queued = (await queueResponse.json()) as ImportSnapshot & { error?: string };
      if (!queueResponse.ok) throw new Error(queued.error ?? "Could not queue the import");

      setSnapshot(queued);
      setFile(null);
      setConfirmed(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Import could not be started");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1.5fr) 110px minmax(180px, 1fr)", gap: 12 }}>
        <label style={{ display: "grid", gap: 7, fontSize: 13, fontWeight: 700 }}>
          Customer CSV
          <input accept=".csv,text/csv" disabled={busy} onChange={(event) => setFile(event.target.files?.[0] ?? null)} type="file" />
        </label>
        <label style={{ display: "grid", gap: 7, fontSize: 13, fontWeight: 700 }}>
          Country
          <input disabled={busy} maxLength={2} onChange={(event) => setCountry(event.target.value.toUpperCase())} value={country} />
        </label>
        <label style={{ display: "grid", gap: 7, fontSize: 13, fontWeight: 700 }}>
          Opt-in source
          <input disabled={busy} onChange={(event) => setSource(event.target.value)} value={source} />
        </label>
      </div>

      <label style={{ display: "flex", alignItems: "flex-start", gap: 9, color: "var(--muted)", fontSize: 13, lineHeight: 1.45 }}>
        <input checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" />
        I confirm these customers agreed to receive WhatsApp marketing from this business. The import timestamp and source will be stored as consent evidence.
      </label>

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button className="secondary" disabled={busy || !file || !confirmed} onClick={startImport} type="button">
          {busy ? "Uploading…" : "Upload and import"}
        </button>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>Required phone header: phone, phone_number, mobile, whatsapp, or whatsapp_number · max 250 MB</span>
      </div>

      {error ? <p style={{ margin: 0, color: "#a23a2a", fontSize: 13 }}>{error}</p> : null}

      {snapshot ? (
        <div className="numberRow">
          <div>
            <strong>{snapshot.fileName}</strong>
            <p style={{ marginBottom: 0 }}>
              {snapshot.status === "completed"
                ? `${snapshot.importedRows.toLocaleString()} contacts imported`
                : snapshot.status === "processing"
                  ? `${snapshot.processedRows.toLocaleString()} rows processed`
                  : snapshot.status === "failed"
                    ? snapshot.errorMessage ?? "Import failed"
                    : "Waiting for an import worker"}
            </p>
          </div>
          <div className="numberMeta">
            <span>{snapshot.invalidRows.toLocaleString()} invalid</span>
            <span>{snapshot.duplicateRows.toLocaleString()} duplicates</span>
            <span className={snapshot.status === "completed" ? "status connected" : "status"}>{snapshot.status.replace("_", " ")}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
