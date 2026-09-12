"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type PhoneOption = {
  id: string;
  wabaId: string;
  label: string;
  throughputMps: number;
};

type TemplateOption = {
  id: string;
  wabaId: string;
  name: string;
  language: string;
  bodyPreview: string;
  variableIndexes: number[];
};

type AudienceOption = {
  key: string;
  type: "all" | "list" | "segment";
  id?: string;
  name: string;
  count: number;
};

type VariableBinding = {
  index: number;
  source: "display_name" | "phone_e164" | "literal";
  value?: string;
  fallback?: string;
};

type Progress = {
  id: string;
  name: string;
  status: string;
  recipientCount: number;
  processed: number;
  progress: number;
  counts: Record<string, number>;
};

export function CampaignBuilder({
  phones,
  templates,
  audiences,
}: {
  phones: PhoneOption[];
  templates: TemplateOption[];
  audiences: AudienceOption[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [audienceKey, setAudienceKey] = useState(audiences[0]?.key ?? "all");
  const selectedAudience = audiences.find((audience) => audience.key === audienceKey) ?? audiences[0];
  const [phoneId, setPhoneId] = useState(phones[0]?.id ?? "");
  const selectedPhone = phones.find((phone) => phone.id === phoneId);
  const availableTemplates = useMemo(
    () => templates.filter((template) => template.wabaId === selectedPhone?.wabaId),
    [templates, selectedPhone?.wabaId],
  );
  const [templateId, setTemplateId] = useState(availableTemplates[0]?.id ?? "");
  const selectedTemplate = availableTemplates.find((template) => template.id === templateId) ?? availableTemplates[0];
  const [bindings, setBindings] = useState<Record<number, VariableBinding>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);

  useEffect(() => {
    if (!selectedTemplate && availableTemplates[0]) setTemplateId(availableTemplates[0].id);
    if (selectedTemplate && !availableTemplates.some((template) => template.id === selectedTemplate.id)) {
      setTemplateId(availableTemplates[0]?.id ?? "");
    }
  }, [availableTemplates, selectedTemplate]);

  useEffect(() => {
    if (!selectedTemplate) {
      setBindings({});
      return;
    }
    setBindings(Object.fromEntries(selectedTemplate.variableIndexes.map((index) => [index, {
      index,
      source: "display_name" as const,
      fallback: "there",
    }])));
  }, [selectedTemplate?.id]);

  useEffect(() => {
    if (!activeCampaignId) return;
    let stopped = false;
    const poll = async () => {
      const response = await fetch(`/api/campaigns/${activeCampaignId}`, { cache: "no-store" });
      if (!response.ok || stopped) return;
      const next = (await response.json()) as Progress;
      setProgress(next);
      if (["completed", "failed", "cancelled"].includes(next.status)) {
        router.refresh();
        return;
      }
      window.setTimeout(poll, 1_500);
    };
    void poll();
    return () => { stopped = true; };
  }, [activeCampaignId, router]);

  const updateBinding = (index: number, patch: Partial<VariableBinding>) => {
    setBindings((current) => ({
      ...current,
      [index]: { ...(current[index] ?? { index, source: "display_name" }), ...patch, index },
    }));
  };

  const launch = async () => {
    if (!name.trim() || !phoneId || !selectedTemplate || !selectedAudience) return;
    setBusy(true);
    setMessage(null);
    try {
      const payloadBindings = selectedTemplate.variableIndexes.map((index) => bindings[index]).filter(Boolean);
      const audience = selectedAudience.type === "all"
        ? { type: "all" as const }
        : { type: selectedAudience.type, id: selectedAudience.id as string };
      const response = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          whatsappPhoneNumberId: phoneId,
          templateId: selectedTemplate.id,
          audience,
          bindings: payloadBindings,
        }),
      });
      const result = (await response.json()) as { campaignId?: string; estimatedSeconds?: number; audienceName?: string; error?: string };
      if (!response.ok || !result.campaignId) throw new Error(result.error ?? "Could not launch campaign");
      setActiveCampaignId(result.campaignId);
      setMessage(`${result.audienceName ?? selectedAudience.name} accepted. Estimated minimum send time is about ${Math.max(1, Math.ceil((result.estimatedSeconds ?? 0) / 60))} minute(s) at this number's current throughput.`);
      setName("");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not launch campaign");
    } finally {
      setBusy(false);
    }
  };

  const throughput = selectedPhone?.throughputMps ?? 0;
  const eligibleContacts = selectedAudience?.count ?? 0;
  const estimatedSeconds = throughput > 0 ? Math.ceil(eligibleContacts / Math.max(1, Math.floor(throughput * 0.95))) : 0;

  if (!phones.length || !templates.length) {
    return <p className="subtitle">Connect a WhatsApp number and sync at least one approved text template before creating a campaign.</p>;
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(190px, 1fr))", gap: 12 }}>
        <label style={{ display: "grid", gap: 7, fontSize: 13, fontWeight: 700 }}>
          Campaign name
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="September offer" maxLength={120} />
        </label>
        <label style={{ display: "grid", gap: 7, fontSize: 13, fontWeight: 700 }}>
          Audience
          <select value={selectedAudience?.key ?? ""} onChange={(event) => setAudienceKey(event.target.value)}>
            {audiences.map((audience) => <option key={audience.key} value={audience.key}>{audience.name} · {audience.count.toLocaleString()}</option>)}
          </select>
        </label>
        <label style={{ display: "grid", gap: 7, fontSize: 13, fontWeight: 700 }}>
          Send from
          <select value={phoneId} onChange={(event) => setPhoneId(event.target.value)}>
            {phones.map((phone) => <option key={phone.id} value={phone.id}>{phone.label} · {phone.throughputMps} msg/s</option>)}
          </select>
        </label>
        <label style={{ display: "grid", gap: 7, fontSize: 13, fontWeight: 700 }}>
          Approved template
          <select value={selectedTemplate?.id ?? ""} onChange={(event) => setTemplateId(event.target.value)}>
            {availableTemplates.map((template) => <option key={template.id} value={template.id}>{template.name} · {template.language}</option>)}
          </select>
        </label>
      </div>

      {selectedTemplate ? (
        <div style={{ padding: 14, border: "1px solid var(--line)", borderRadius: 12 }}>
          <p className="eyebrow">Template preview</p>
          <p style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>{selectedTemplate.bodyPreview}</p>
        </div>
      ) : null}

      {selectedTemplate?.variableIndexes.length ? (
        <div style={{ display: "grid", gap: 12 }}>
          <strong style={{ fontSize: 13 }}>Template variable mapping</strong>
          {selectedTemplate.variableIndexes.map((index) => {
            const binding = bindings[index] ?? { index, source: "display_name" as const, fallback: "there" };
            return (
              <div key={index} style={{ display: "grid", gridTemplateColumns: "80px 220px minmax(220px, 1fr)", gap: 12, alignItems: "center" }}>
                <code>{`{{${index}}}`}</code>
                <select value={binding.source} onChange={(event) => updateBinding(index, { source: event.target.value as VariableBinding["source"] })}>
                  <option value="display_name">Contact name</option>
                  <option value="phone_e164">Contact phone</option>
                  <option value="literal">Fixed text</option>
                </select>
                {binding.source === "display_name" ? (
                  <input value={binding.fallback ?? "there"} onChange={(event) => updateBinding(index, { fallback: event.target.value })} placeholder="Fallback when name is missing" />
                ) : binding.source === "literal" ? (
                  <input value={binding.value ?? ""} onChange={(event) => updateBinding(index, { value: event.target.value })} placeholder="Text sent to every recipient" />
                ) : (
                  <span className="subtitle">Uses the frozen E.164 phone from the campaign snapshot.</span>
                )}
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="statsGrid" style={{ marginTop: 0 }}>
        <article className="statCard"><span>Eligible audience</span><strong>{eligibleContacts.toLocaleString()}</strong><p>{selectedAudience?.name ?? "Selected audience"}</p></article>
        <article className="statCard"><span>Throughput</span><strong>{throughput ? `${throughput} msg/s` : "—"}</strong><p>Current phone-number setting</p></article>
        <article className="statCard"><span>Estimated send</span><strong>{estimatedSeconds ? `${Math.max(1, Math.ceil(estimatedSeconds / 60))} min` : "—"}</strong><p>Uses a 95% safety target</p></article>
        <article className="statCard"><span>Queue runway</span><strong>{throughput ? `${Math.min(20_000, Math.max(1_000, throughput * 15)).toLocaleString()}` : "—"}</strong><p>Jobs buffered, not entire audience</p></article>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button className="primary" disabled={busy || !name.trim() || !selectedTemplate || eligibleContacts === 0} onClick={launch} type="button">
          {busy ? "Launching…" : `Launch to ${eligibleContacts.toLocaleString()} contacts`}
        </button>
        {message ? <span style={{ color: "var(--muted)", fontSize: 13 }}>{message}</span> : null}
      </div>

      {progress ? (
        <div className="numberRow" style={{ alignItems: "start" }}>
          <div style={{ flex: 1 }}>
            <strong>{progress.name}</strong>
            <p style={{ margin: "7px 0" }}>{progress.status} · {progress.processed.toLocaleString()} / {progress.recipientCount.toLocaleString()} processed</p>
            <div style={{ height: 8, borderRadius: 999, background: "var(--line)", overflow: "hidden" }}>
              <div style={{ width: `${Math.round(progress.progress * 100)}%`, height: "100%", background: "currentColor" }} />
            </div>
          </div>
          <div className="numberMeta">
            <span>{(progress.counts.queued ?? 0).toLocaleString()} queued</span>
            <span>{(progress.counts.submitted ?? 0).toLocaleString()} submitted</span>
            <span>{(progress.counts.failed ?? 0).toLocaleString()} failed</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
