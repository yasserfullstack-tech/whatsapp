"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Action = "pause" | "resume" | "cancel";

export function CampaignControls({ campaignId, initialStatus }: { campaignId: string; initialStatus: string }) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState<Action | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const run = async (action: Action) => {
    if (action === "cancel" && !window.confirm("Cancel this campaign? Recipients not yet submitted to Meta will be skipped.")) return;
    setBusy(action);
    setMessage(null);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const result = (await response.json()) as { status?: string; error?: string };
      if (!response.ok || !result.status) throw new Error(result.error ?? `Could not ${action} campaign`);
      setStatus(result.status);
      setMessage(action === "pause"
        ? "Paused: no new recipients will be queued. The small runway already queued may finish sending."
        : action === "cancel"
          ? "Cancelled: unsent recipients were skipped. Requests already in flight at Meta cannot be recalled."
          : "Campaign resumed.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Could not ${action} campaign`);
    } finally {
      setBusy(null);
    }
  };

  const active = status === "sending";
  const preparing = status === "dispatching";
  const paused = status === "paused";
  if (!active && !paused && !preparing) return null;

  return (
    <section className="panel" style={{ marginBottom: 18 }}>
      <div className="panelHeader">
        <div>
          <p className="eyebrow">Campaign controls</p>
          <h2>{status}</h2>
          <p className="subtitle">
            {preparing
              ? "The immutable audience snapshot is being created. Pause/cancel controls activate as soon as sending begins."
              : "Pause stops new queueing; cancel skips recipients that have not yet been submitted to Meta."}
          </p>
        </div>
        {!preparing ? (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {active ? <button className="secondary" disabled={busy !== null} onClick={() => void run("pause")} type="button">{busy === "pause" ? "Pausing…" : "Pause"}</button> : null}
            {paused ? <button className="primary" disabled={busy !== null} onClick={() => void run("resume")} type="button">{busy === "resume" ? "Resuming…" : "Resume"}</button> : null}
            <button className="secondary" disabled={busy !== null} onClick={() => void run("cancel")} type="button">{busy === "cancel" ? "Cancelling…" : "Cancel campaign"}</button>
          </div>
        ) : null}
      </div>
      {message ? <p className="subtitle" style={{ marginTop: 12 }}>{message}</p> : null}
    </section>
  );
}
