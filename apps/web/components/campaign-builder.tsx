"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/i18n-provider";

type PhoneOption = { id: string; wabaId: string; label: string; throughputMps: number };
type TemplateOption = { id: string; wabaId: string; name: string; language: string; bodyPreview: string; variableIndexes: number[] };
type AudienceOption = { key: string; type: "all" | "list" | "segment"; id?: string; name: string; count: number };
type VariableBinding = { index: number; source: "display_name" | "phone_e164" | "literal"; value?: string; fallback?: string };
type Progress = { id: string; name: string; status: string; recipientCount: number; processed: number; progress: number; counts: Record<string, number> };
type OnboardingTestCopy = { title: string; description: string; limit: string };

export function CampaignBuilder({
  phones,
  templates,
  audiences,
  onboardingTestMode = false,
  onboardingTestCopy,
}: {
  phones: PhoneOption[];
  templates: TemplateOption[];
  audiences: AudienceOption[];
  onboardingTestMode?: boolean;
  onboardingTestCopy?: OnboardingTestCopy;
}) {
  const router = useRouter();
  const { messages, number, format } = useI18n();
  const [name, setName] = useState("");
  const [audienceKey, setAudienceKey] = useState(audiences[0]?.key ?? "all");
  const selectedAudience = audiences.find((audience) => audience.key === audienceKey) ?? audiences[0];
  const [phoneId, setPhoneId] = useState(phones[0]?.id ?? "");
  const selectedPhone = phones.find((phone) => phone.id === phoneId);
  const availableTemplates = useMemo(() => templates.filter((template) => template.wabaId === selectedPhone?.wabaId), [templates, selectedPhone?.wabaId]);
  const [templateId, setTemplateId] = useState(availableTemplates[0]?.id ?? "");
  const selectedTemplate = availableTemplates.find((template) => template.id === templateId) ?? availableTemplates[0];
  const [bindings, setBindings] = useState<Record<number, VariableBinding>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);

  useEffect(() => {
    if (!selectedTemplate && availableTemplates[0]) setTemplateId(availableTemplates[0].id);
    if (selectedTemplate && !availableTemplates.some((template) => template.id === selectedTemplate.id)) setTemplateId(availableTemplates[0]?.id ?? "");
  }, [availableTemplates, selectedTemplate]);

  useEffect(() => {
    if (!selectedTemplate) {
      setBindings({});
      return;
    }
    setBindings(Object.fromEntries(selectedTemplate.variableIndexes.map((index) => [index, { index, source: "display_name" as const, fallback: "there" }])));
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

  const updateBinding = (index: number, patch: Partial<VariableBinding>) => setBindings((current) => ({
    ...current,
    [index]: { ...(current[index] ?? { index, source: "display_name" }), ...patch, index },
  }));

  const launch = async () => {
    if (!name.trim() || !phoneId || !selectedTemplate || !selectedAudience) return;
    setBusy(true);
    setMessage(null);
    try {
      const payloadBindings = selectedTemplate.variableIndexes.map((index) => bindings[index]).filter(Boolean);
      const audience = selectedAudience.type === "all" ? { type: "all" as const } : { type: selectedAudience.type, id: selectedAudience.id as string };
      const response = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          whatsappPhoneNumberId: phoneId,
          templateId: selectedTemplate.id,
          audience,
          bindings: payloadBindings,
          onboardingTest: onboardingTestMode,
        }),
      });
      const result = (await response.json()) as { campaignId?: string; estimatedSeconds?: number; audienceName?: string; error?: string };
      if (!response.ok || !result.campaignId) throw new Error(result.error ?? messages.ui.launchFailed);
      setActiveCampaignId(result.campaignId);
      setMessage(format(messages.ui.campaignAccepted, { audience: result.audienceName ?? selectedAudience.name, minutes: Math.max(1, Math.ceil((result.estimatedSeconds ?? 0) / 60)) }));
      setName("");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : messages.ui.launchFailed);
    } finally {
      setBusy(false);
    }
  };

  const throughput = selectedPhone?.throughputMps ?? 0;
  const eligibleContacts = selectedAudience?.count ?? 0;
  const estimatedSeconds = throughput > 0 ? Math.ceil(eligibleContacts / Math.max(1, Math.floor(throughput * 0.95))) : 0;
  const testAudienceTooLarge = onboardingTestMode && eligibleContacts > 5;

  if (!phones.length || !templates.length) return <p className="subtitle">{messages.ui.campaignPrerequisite}</p>;

  return <div style={{ display: "grid", gap: 18 }}>
    {onboardingTestMode && onboardingTestCopy ? (
      <div className="panelInset">
        <p className="eyebrow">{onboardingTestCopy.title}</p>
        <p>{onboardingTestCopy.description}</p>
        <strong>{onboardingTestCopy.limit}</strong>
      </div>
    ) : null}
    <div className="formGrid4">
      <label className="formLabel">{messages.ui.campaignName}<input value={name} onChange={(event) => setName(event.target.value)} placeholder={messages.ui.campaignNamePlaceholder} maxLength={120} /></label>
      <label className="formLabel">{messages.ui.audience}<select value={selectedAudience?.key ?? ""} onChange={(event) => setAudienceKey(event.target.value)}>{audiences.map((audience) => <option key={audience.key} value={audience.key}>{audience.name} · {number(audience.count)}</option>)}</select></label>
      <label className="formLabel">{messages.ui.sendFrom}<select value={phoneId} onChange={(event) => setPhoneId(event.target.value)}>{phones.map((phone) => <option key={phone.id} value={phone.id}>{phone.label} · {number(phone.throughputMps)} msg/s</option>)}</select></label>
      <label className="formLabel">{messages.ui.approvedTemplate}<select value={selectedTemplate?.id ?? ""} onChange={(event) => setTemplateId(event.target.value)}>{availableTemplates.map((template) => <option key={template.id} value={template.id}>{template.name} · {template.language}</option>)}</select></label>
    </div>
    {selectedTemplate ? <div className="panelInset"><p className="eyebrow">{messages.ui.templatePreview}</p><p style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>{selectedTemplate.bodyPreview}</p></div> : null}
    {selectedTemplate?.variableIndexes.length ? <div style={{ display: "grid", gap: 12 }}><strong>{messages.ui.variableMapping}</strong>{selectedTemplate.variableIndexes.map((index) => { const binding = bindings[index] ?? { index, source: "display_name" as const, fallback: "there" }; return <div key={index} className="bindingRow"><code>{`{{${index}}}`}</code><select value={binding.source} onChange={(event) => updateBinding(index, { source: event.target.value as VariableBinding["source"] })}><option value="display_name">{messages.ui.contactName}</option><option value="phone_e164">{messages.ui.contactPhone}</option><option value="literal">{messages.ui.fixedText}</option></select>{binding.source === "display_name" ? <input value={binding.fallback ?? "there"} onChange={(event) => updateBinding(index, { fallback: event.target.value })} placeholder={messages.ui.fallbackName} /> : binding.source === "literal" ? <input value={binding.value ?? ""} onChange={(event) => updateBinding(index, { value: event.target.value })} placeholder={messages.ui.fixedTextPlaceholder} /> : <span className="subtitle">{messages.ui.frozenPhoneHint}</span>}</div>; })}</div> : null}
    <div className="statsGrid" style={{ marginTop: 0 }}>
      <article className="statCard"><span>{messages.ui.eligibleAudience}</span><strong>{number(eligibleContacts)}</strong><p>{selectedAudience?.name ?? messages.ui.selectedAudience}</p></article>
      <article className="statCard"><span>{messages.ui.throughput}</span><strong>{throughput ? `${number(throughput)} msg/s` : "—"}</strong><p>{messages.ui.currentNumberSetting}</p></article>
      <article className="statCard"><span>{messages.ui.estimatedSend}</span><strong>{estimatedSeconds ? `${number(Math.max(1, Math.ceil(estimatedSeconds / 60)))} min` : "—"}</strong><p>{messages.ui.safetyTarget}</p></article>
      <article className="statCard"><span>{messages.ui.queueRunway}</span><strong>{throughput ? number(Math.min(20_000, Math.max(1_000, throughput * 15))) : "—"}</strong><p>{messages.ui.bufferedJobsHint}</p></article>
    </div>
    <div className="actionRow">
      <button className="primary" disabled={busy || !name.trim() || !selectedTemplate || eligibleContacts === 0 || testAudienceTooLarge} onClick={launch} type="button">{busy ? messages.ui.launching : format(messages.ui.launchToContacts, { count: number(eligibleContacts) })}</button>
      {testAudienceTooLarge && onboardingTestCopy ? <span className="subtitle">{onboardingTestCopy.limit}</span> : message ? <span className="subtitle">{message}</span> : null}
    </div>
    {progress ? <div className="numberRow"><div style={{ flex: 1 }}><strong>{progress.name}</strong><p>{progress.status} · {format(messages.ui.processedProgress, { processed: number(progress.processed), total: number(progress.recipientCount) })}</p><div className="progressTrack"><div style={{ width: `${Math.round(progress.progress * 100)}%` }} /></div></div><div className="numberMeta"><span>{number(progress.counts.queued ?? 0)} {messages.ui.queued}</span><span>{number(progress.counts.submitted ?? 0)} {messages.ui.submitted}</span><span>{number(progress.counts.failed ?? 0)} {messages.ui.failed}</span></div></div> : null}
  </div>;
}
