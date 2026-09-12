"use client";

import { useEffect, useState } from "react";

type Analytics = {
  id: string;
  name: string;
  status: string;
  recipientCount: number;
  counts: Record<string, number>;
  funnel: {
    accepted: number;
    sent: number;
    delivered: number;
    read: number;
    failed: number;
  };
  rates: {
    acceptance: number;
    delivery: number;
    read: number;
    failure: number;
  };
  processed: number;
  progress: number;
  submissionSettled: boolean;
  recentFailures: Array<{
    id: string;
    displayName: string | null;
    phoneE164: string;
    errorCode: string | null;
    lastError: string | null;
    attemptCount: number;
    failedAt: string | null;
  }>;
};

function percent(value: number): string {
  return `${(Math.max(0, Math.min(1, value)) * 100).toFixed(1)}%`;
}

export function CampaignAnalytics({ campaignId }: { campaignId: string }) {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const response = await fetch(`/api/campaigns/${campaignId}`, { cache: "no-store" });
        const result = (await response.json()) as Analytics & { error?: string };
        if (!response.ok) throw new Error(result.error ?? "Could not load campaign analytics");
        if (stopped) return;
        setAnalytics(result);
        setError(null);
      } catch (caught) {
        if (!stopped) setError(caught instanceof Error ? caught.message : "Could not load campaign analytics");
      } finally {
        if (!stopped) timer = window.setTimeout(poll, 3_000);
      }
    };

    void poll();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [campaignId]);

  if (!analytics) {
    return <p className="subtitle">{error ?? "Loading live delivery analytics…"}</p>;
  }

  const queued = analytics.counts.queued ?? 0;
  const submitted = analytics.counts.submitted ?? 0;

  return (
    <div style={{ display: "grid", gap: 18 }}>
      {error ? <p style={{ margin: 0, color: "#a23a2a", fontSize: 13 }}>{error}</p> : null}

      <section className="statsGrid" aria-label="Delivery funnel">
        <article className="statCard"><span>Accepted by Meta</span><strong>{analytics.funnel.accepted.toLocaleString()}</strong><p>{percent(analytics.rates.acceptance)} of snapshot</p></article>
        <article className="statCard"><span>Delivered</span><strong>{analytics.funnel.delivered.toLocaleString()}</strong><p>{percent(analytics.rates.delivery)} of accepted</p></article>
        <article className="statCard"><span>Read</span><strong>{analytics.funnel.read.toLocaleString()}</strong><p>{percent(analytics.rates.read)} of delivered</p></article>
        <article className="statCard"><span>Failed</span><strong>{analytics.funnel.failed.toLocaleString()}</strong><p>{percent(analytics.rates.failure)} of snapshot</p></article>
      </section>

      <section className="panel">
        <div className="panelHeader">
          <div>
            <p className="eyebrow">Live progress</p>
            <h2>{analytics.status}</h2>
            <p className="subtitle">
              {analytics.processed.toLocaleString()} / {analytics.recipientCount.toLocaleString()} recipients submitted or failed
              {analytics.submissionSettled ? " · submission pass settled" : ` · ${queued.toLocaleString()} queued · ${submitted.toLocaleString()} awaiting status`}.
            </p>
          </div>
        </div>
        <div style={{ height: 10, borderRadius: 999, background: "var(--line)", overflow: "hidden", marginTop: 16 }}>
          <div style={{ width: `${Math.round(analytics.progress * 100)}%`, height: "100%", background: "currentColor" }} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(120px, 1fr))", gap: 12, marginTop: 18 }}>
          <div><span className="subtitle">Sent</span><strong style={{ display: "block", marginTop: 4 }}>{analytics.funnel.sent.toLocaleString()}</strong></div>
          <div><span className="subtitle">Delivered</span><strong style={{ display: "block", marginTop: 4 }}>{analytics.funnel.delivered.toLocaleString()}</strong></div>
          <div><span className="subtitle">Read</span><strong style={{ display: "block", marginTop: 4 }}>{analytics.funnel.read.toLocaleString()}</strong></div>
          <div><span className="subtitle">Still submitted</span><strong style={{ display: "block", marginTop: 4 }}>{submitted.toLocaleString()}</strong></div>
        </div>
      </section>

      <section className="panel">
        <div className="panelHeader"><div><p className="eyebrow">Failures</p><h2>Recent failed recipients</h2><p className="subtitle">Latest 20 failures from immediate send attempts or Meta status webhooks.</p></div></div>
        {analytics.recentFailures.length ? (
          <div className="numberList" style={{ marginTop: 14 }}>
            {analytics.recentFailures.map((failure) => (
              <div className="numberRow" key={failure.id} style={{ alignItems: "start" }}>
                <div style={{ minWidth: 0 }}>
                  <strong>{failure.displayName ?? failure.phoneE164}</strong>
                  <p style={{ margin: "6px 0 0", overflowWrap: "anywhere" }}>{failure.lastError ?? "Meta reported a failed status without additional details."}</p>
                </div>
                <div className="numberMeta">
                  <span>{failure.errorCode ? `Code ${failure.errorCode}` : "No error code"}</span>
                  <span>{failure.attemptCount} attempt{failure.attemptCount === 1 ? "" : "s"}</span>
                  <span>{failure.failedAt ? new Date(failure.failedAt).toLocaleString() : "Failure time unavailable"}</span>
                </div>
              </div>
            ))}
          </div>
        ) : <p className="subtitle" style={{ marginTop: 14 }}>No failed recipients recorded.</p>}
      </section>
    </div>
  );
}
