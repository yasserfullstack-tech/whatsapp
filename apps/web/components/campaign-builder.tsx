"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { TemplateParameterBinding, TemplateParameterSlot } from "@wa/meta/templates";
import { TemplatePreview } from "@/components/template-preview";
import { useI18n } from "@/components/i18n-provider";

type PhoneOption = { id: string; wabaId: string; label: string; throughputMps: number };
type TemplateOption = { id: string; wabaId: string; name: string; language: string; components: unknown[]; slots: TemplateParameterSlot[] };
type AudienceOption = { key: string; type: "all" | "list" | "segment"; id?: string; name: string; count: number };
type Progress = { id: string; name: string; status: string; recipientCount: number; processed: number; progress: number; counts: Record<string, number> };

function defaultBinding(slot: TemplateParameterSlot): TemplateParameterBinding {
  const literalOnly = slot.parameterType === "image" || slot.parameterType === "video" || slot.parameterType === "document" || slot.parameterType === "payload";
  return {
    key: slot.key,
    index: slot.index,
    component: slot.component,
    parameterType: slot.parameterType,
    ...(slot.buttonIndex === undefined ? {} : { buttonIndex: slot.buttonIndex }),
    ...(slot.buttonSubType === undefined ? {} : { buttonSubType: slot.buttonSubType }),
    source: literalOnly ? "literal" : "display_name",
    ...(literalOnly ? { value: "" } : { fallback: "" }),
  };
}

function bindingValid(slot: TemplateParameterSlot, binding: TemplateParameterBinding | undefined): boolean {
  if (!binding) return false;
  if (slot.parameterType === "image" || slot.parameterType === "video" || slot.parameterType === "document") {
    if (binding.source !== "literal" || !binding.value?.trim()) return false;
    try { return new URL(binding.value).protocol === "https:"; } catch { return false; }
  }
  if (slot.parameterType === "payload") return binding.source === "literal" && Boolean(binding.value?.trim());
  if (binding.source === "display_name") return Boolean(binding.fallback?.trim());
  if (binding.source === "literal") return Boolean(binding.value?.trim());
  return true;
}

export function CampaignBuilder({ phones, templates, audiences }: { phones: PhoneOption[]; templates: TemplateOption[]; audiences: AudienceOption[] }) {
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
  const [bindings, setBindings] = useState<Record<string, TemplateParameterBinding>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);

  useEffect(() => {
    if (!selectedTemplate && availableTemplates[0]) setTemplateId(availableTemplates[0].id);
    if (selectedTemplate && !availableTemplates.some((template) => template.id === selectedTemplate.id)) setTemplateId(availableTemplates[0]?.id ?? "");
  }, [availableTemplates, selectedTemplate]);

  useEffect(() => {
    if (!selectedTemplate) { setBindings({}); return; }
    setBindings(Object.fromEntries(selectedTemplate.slots.map((slot) => [slot.key, defaultBinding(slot)])));
  }, [selectedTemplate?.id]);

  useEffect(() => {
    if (!activeCampaignId) return;
    let stopped = false;
    const poll = async () => {
      const response = await fetch(`/api/campaigns/${activeCampaignId}`, { cache: "no-store" });
      if (!response.ok || stopped) return;
      const next = (await response.json()) as Progress;
      setProgress(next);
      if (["completed", "failed", "cancelled"].includes(next.status)) { router.refresh(); return; }
      window.setTimeout(poll, 1_500);
    };
    void poll();
    return () => { stopped = true; };
  }, [activeCampaignId, router]);

  const updateBinding = (slot: TemplateParameterSlot, patch: Partial<TemplateParameterBinding>) => setBindings((current) => ({
    ...current,
    [slot.key]: { ...(current[slot.key] ?? defaultBinding(slot)), ...patch, key: slot.key, index: slot.index },
  }));
  const bindingsValid = selectedTemplate?.slots.every((slot) => bindingValid(slot, bindings[slot.key])) ?? true;

  const launch = async () => {
    if (!name.trim() || !phoneId || !selectedTemplate || !selectedAudience || !bindingsValid) return;
    setBusy(true);
    setMessage(null);
    try {
      const payloadBindings = selectedTemplate.slots.map((slot) => bindings[slot.key]).filter(Boolean);
      const audience = selectedAudience.type === "all" ? { type: "all" as const } : { type: selectedAudience.type, id: selectedAudience.id as string };
      const response = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, whatsappPhoneNumberId: phoneId, templateId: selectedTemplate.id, audience, bindings: payloadBindings }),
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
  if (!phones.length || !templates.length) return <p className="subtitle">{messages.ui.campaignPrerequisite}</p>;

  return <div style={{ display: "grid", gap: 18 }}>
    <div className="formGrid4">
      <label className="formLabel">{messages.ui.campaignName}<input value={name} onChange={(event) => setName(event.target.value)} placeholder={messages.ui.campaignNamePlaceholder} maxLength={120} /></label>
      <label className="formLabel">{messages.ui.audience}<select value={selectedAudience?.key ?? ""} onChange={(event) => setAudienceKey(event.target.value)}>{audiences.map((audience) => <option key={audience.key} value={audience.key}>{audience.name} · {number(audience.count)}</option>)}</select></label>
      <label className="formLabel">{messages.ui.sendFrom}<select value={phoneId} onChange={(event) => setPhoneId(event.target.value)}>{phones.map((phone) => <option key={phone.id} value={phone.id}>{phone.label} · {number(phone.throughputMps)} msg/s</option>)}</select></label>
      <label className="formLabel">{messages.ui.approvedTemplate}<select value={selectedTemplate?.id ?? ""} onChange={(event) => setTemplateId(event.target.value)}>{availableTemplates.map((template) => <option key={template.id} value={template.id}>{template.name} · {template.language}</option>)}</select></label>
    </div>

    {selectedTemplate ? <div><p className="eyebrow">{messages.ui.templatePreview}</p><TemplatePreview components={selectedTemplate.components} /></div> : null}

    {selectedTemplate?.slots.length ? <div style={{ display: "grid", gap: 12 }}>
      <strong>{messages.ui.variableMapping}</strong>
      {selectedTemplate.slots.map((slot) => {
        const binding = bindings[slot.key] ?? defaultBinding(slot);
        const literalOnly = slot.parameterType === "image" || slot.parameterType === "video" || slot.parameterType === "document" || slot.parameterType === "payload";
        return <div key={slot.key} className="bindingRow">
          <code>{slot.label}</code>
          {literalOnly ? <span className="subtitle">Fixed {slot.parameterType}</span> : <select value={binding.source} onChange={(event) => updateBinding(slot, { source: event.target.value as TemplateParameterBinding["source"] })}><option value="display_name">{messages.ui.contactName}</option><option value="phone_e164">{messages.ui.contactPhone}</option><option value="literal">{messages.ui.fixedText}</option></select>}
          {binding.source === "display_name" ? <input value={binding.fallback ?? ""} onChange={(event) => updateBinding(slot, { fallback: event.target.value })} placeholder={messages.ui.fallbackName} required /> : binding.source === "literal" ? <input value={binding.value ?? ""} onChange={(event) => updateBinding(slot, { value: event.target.value })} placeholder={slot.parameterType === "image" || slot.parameterType === "video" || slot.parameterType === "document" ? "https://cdn.example.com/media" : slot.parameterType === "payload" ? "quick-reply-payload" : messages.ui.fixedTextPlaceholder} required /> : <span className="subtitle">{messages.ui.frozenPhoneHint}</span>}
        </div>;
      })}
    </div> : null}

    <div className="statsGrid" style={{ marginTop: 0 }}>
      <article className="statCard"><span>{messages.ui.eligibleAudience}</span><strong>{number(eligibleContacts)}</strong><p>{selectedAudience?.name ?? messages.ui.selectedAudience}</p></article>
      <article className="statCard"><span>{messages.ui.throughput}</span><strong>{throughput ? `${number(throughput)} msg/s` : "—"}</strong><p>{messages.ui.currentNumberSetting}</p></article>
      <article className="statCard"><span>{messages.ui.estimatedSend}</span><strong>{estimatedSeconds ? `${number(Math.max(1, Math.ceil(estimatedSeconds / 60)))} min` : "—"}</strong><p>{messages.ui.safetyTarget}</p></article>
      <article className="statCard"><span>{messages.ui.queueRunway}</span><strong>{throughput ? number(Math.min(20_000, Math.max(1_000, throughput * 15))) : "—"}</strong><p>{messages.ui.bufferedJobsHint}</p></article>
    </div>
    <div className="actionRow"><button className="primary" disabled={busy || !name.trim() || !selectedTemplate || eligibleContacts === 0 || !bindingsValid} onClick={launch} type="button">{busy ? messages.ui.launching : format(messages.ui.launchToContacts, { count: number(eligibleContacts) })}</button>{message ? <span className="subtitle">{message}</span> : null}</div>
    {progress ? <div className="numberRow"><div style={{ flex: 1 }}><strong>{progress.name}</strong><p>{progress.status} · {format(messages.ui.processedProgress, { processed: number(progress.processed), total: number(progress.recipientCount) })}</p><div className="progressTrack"><div style={{ width: `${Math.round(progress.progress * 100)}%` }} /></div></div><div className="numberMeta"><span>{number(progress.counts.queued ?? 0)} {messages.ui.queued}</span><span>{number(progress.counts.submitted ?? 0)} {messages.ui.submitted}</span><span>{number(progress.counts.failed ?? 0)} {messages.ui.failed}</span></div></div> : null}
  </div>;
}
