"use client";

import { useEffect, useMemo, useState } from "react";
import { DestructiveConfirmDialog } from "@/components/destructive-confirm-dialog";

type ExportKind = "contacts" | "campaign_recipients" | "consent_history" | "campaigns" | "workspace";
type ExportJob = {
  id: string;
  kind: ExportKind;
  status: "queued" | "processing" | "completed" | "failed" | "expired";
  fileName: string;
  rowCount: number;
  expiresAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
};
type Retention = {
  rawWebhookDays: number;
  importFileDays: number;
  exportFileHours: number;
  auditLogDays: number;
  campaignRecipientDays: number;
};
type DeletionRequest = {
  id: string;
  status: string;
  coolingOffEndsAt: string;
  purgeAfter: string;
  errorMessage?: string | null;
} | null;

type Props = {
  locale: "en" | "ar";
  workspaceSlug: string;
  canExport: boolean;
  canManageRetention: boolean;
  canDeleteWorkspace: boolean;
  initialJobs: ExportJob[];
  initialRetention: Retention;
  initialDeletion: DeletionRequest;
};

const copy = {
  en: {
    exports: "Exports",
    exportsHelp: "Large exports run in the worker and are stored temporarily in R2. Download links are signed for five minutes.",
    contacts: "Export contacts",
    consent: "Export consent records",
    campaigns: "Export campaigns",
    workspace: "Export workspace data",
    refresh: "Refresh",
    download: "Download",
    rows: "rows",
    retention: "Retention policies",
    retentionHelp: "Cleanup workers apply these limits automatically. Billing/platform audit records are outside these workspace purge rules.",
    webhook: "Raw webhook days",
    import: "Import file days",
    exportHours: "Export file hours",
    audit: "Workspace audit days",
    recipients: "Campaign recipient days",
    save: "Save retention",
    danger: "Danger zone",
    deleteWorkspace: "Delete workspace",
    deleteWorkspaceHelp: "Owner only. Type the workspace slug. There is a 7-day cooling-off period, then the workspace is disabled for 24 hours before asynchronous purge.",
    acknowledge: "I understand this will permanently purge workspace data and tenant-scoped R2 objects.",
    schedule: "Schedule deletion",
    cancel: "Cancel deletion request",
    account: "Delete account",
    accountHelp: "Type DELETE ACCOUNT. You must first transfer ownership or delete every workspace you own.",
    deleteAccount: "Delete account permanently",
    confirmAccountTitle: "Permanently delete your account?",
    confirmAccountDescription: "This final step cannot be undone. Your account will be deleted after the server verifies that you no longer own any workspaces.",
    confirmAccountAction: "Yes, delete my account",
    cancelAction: "Keep my account",
    reauth: "Destructive actions require a recent sign-in. Sign out and sign back in if requested.",
  },
  ar: {
    exports: "تصدير البيانات",
    exportsHelp: "تُنفَّذ عمليات التصدير الكبيرة في العامل وتُحفظ مؤقتًا في R2. روابط التنزيل موقعة لمدة خمس دقائق.",
    contacts: "تصدير جهات الاتصال",
    consent: "تصدير سجلات الموافقة",
    campaigns: "تصدير الحملات",
    workspace: "تصدير بيانات مساحة العمل",
    refresh: "تحديث",
    download: "تنزيل",
    rows: "سجل",
    retention: "سياسات الاحتفاظ",
    retentionHelp: "تطبق مهام التنظيف هذه الحدود تلقائيًا. سجلات الفوترة وتدقيق المنصة خارج قواعد حذف مساحة العمل.",
    webhook: "أيام الاحتفاظ بـ Webhook الخام",
    import: "أيام الاحتفاظ بملفات الاستيراد",
    exportHours: "ساعات الاحتفاظ بملفات التصدير",
    audit: "أيام سجل تدقيق مساحة العمل",
    recipients: "أيام سجل مستلمي الحملات",
    save: "حفظ سياسة الاحتفاظ",
    danger: "منطقة خطرة",
    deleteWorkspace: "حذف مساحة العمل",
    deleteWorkspaceHelp: "للمالك فقط. اكتب معرّف مساحة العمل. توجد مهلة تراجع 7 أيام، ثم تُعطّل المساحة 24 ساعة قبل الحذف غير المتزامن.",
    acknowledge: "أفهم أن هذا سيحذف بيانات مساحة العمل وكائنات R2 الخاصة بها نهائيًا.",
    schedule: "جدولة الحذف",
    cancel: "إلغاء طلب الحذف",
    account: "حذف الحساب",
    accountHelp: "اكتب DELETE ACCOUNT. يجب نقل ملكية أو حذف كل مساحة عمل تملكها أولًا.",
    deleteAccount: "حذف الحساب نهائيًا",
    confirmAccountTitle: "هل تريد حذف حسابك نهائيًا؟",
    confirmAccountDescription: "لا يمكن التراجع عن هذه الخطوة النهائية. سيُحذف حسابك بعد أن يتحقق الخادم من أنك لم تعد تملك أي مساحة عمل.",
    confirmAccountAction: "نعم، احذف حسابي",
    cancelAction: "الاحتفاظ بحسابي",
    reauth: "الإجراءات الحساسة تتطلب تسجيل دخول حديثًا. سجّل الخروج ثم الدخول إذا طُلب ذلك.",
  },
} as const;

export function DataLifecyclePanel(props: Props) {
  const t = copy[props.locale];
  const [jobs, setJobs] = useState(props.initialJobs);
  const [retention, setRetention] = useState(props.initialRetention);
  const [deletion, setDeletion] = useState(props.initialDeletion);
  const [workspaceConfirmation, setWorkspaceConfirmation] = useState("");
  const [acknowledge, setAcknowledge] = useState(false);
  const [accountConfirmation, setAccountConfirmation] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hasRunning = useMemo(() => jobs.some((job) => job.status === "queued" || job.status === "processing"), [jobs]);

  async function refreshExports() {
    const response = await fetch("/api/settings/data/export", { cache: "no-store" });
    if (!response.ok) return;
    const body = await response.json() as { jobs: ExportJob[] };
    setJobs(body.jobs);
  }

  useEffect(() => {
    if (!hasRunning) return;
    const timer = window.setInterval(() => void refreshExports(), 4_000);
    return () => window.clearInterval(timer);
  }, [hasRunning]);

  async function requestExport(kind: ExportKind) {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/settings/data/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Export request failed");
      await refreshExports();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Export request failed"); }
    finally { setBusy(false); }
  }

  async function download(id: string) {
    setMessage(null);
    const response = await fetch(`/api/settings/data/export/${id}/download`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) { setMessage(body.error ?? "Download failed"); return; }
    window.location.assign(body.url as string);
  }

  async function saveRetention() {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/settings/data/retention", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(retention),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not save retention policy");
      setMessage(props.locale === "ar" ? "تم حفظ سياسة الاحتفاظ." : "Retention policy saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save retention policy"); }
    finally { setBusy(false); }
  }

  async function scheduleDeletion() {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/settings/data/workspace-deletion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation: workspaceConfirmation, acknowledge }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not schedule deletion");
      setDeletion(body.request as DeletionRequest);
      setMessage(props.locale === "ar" ? "تمت جدولة حذف مساحة العمل." : "Workspace deletion scheduled.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not schedule deletion"); }
    finally { setBusy(false); }
  }

  async function cancelDeletion() {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/settings/data/workspace-deletion", { method: "DELETE" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not cancel deletion");
      setDeletion(null);
      setMessage(props.locale === "ar" ? "تم إلغاء طلب الحذف." : "Deletion request cancelled.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not cancel deletion"); }
    finally { setBusy(false); }
  }

  async function deleteAccount(): Promise<boolean> {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/settings/data/account-deletion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation: accountConfirmation }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not delete account");
      window.location.assign("/sign-in");
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not delete account");
      return false;
    } finally { setBusy(false); }
  }

  const exportButtons: Array<[ExportKind, string]> = [
    ["contacts", t.contacts], ["consent_history", t.consent], ["campaigns", t.campaigns], ["workspace", t.workspace],
  ];

  return <div className="dataLifecycleGrid">
    {message ? <div className="settingsCallout" role="status"><strong>{message}</strong></div> : null}

    <section className="panel settingsPanel">
      <div className="dataSectionHeader"><div><h2>{t.exports}</h2><p>{t.exportsHelp}</p></div><button type="button" onClick={() => void refreshExports()}>{t.refresh}</button></div>
      {props.canExport ? <div className="dataActionGrid">{exportButtons.map(([kind, label]) => <button className="primary" disabled={busy} key={kind} onClick={() => void requestExport(kind)}>{label}</button>)}</div> : null}
      <div className="settingsList">
        {jobs.length ? jobs.map((job) => <div className="settingsListRow" key={job.id}>
          <div><strong>{job.fileName}</strong><p>{job.kind.replaceAll("_", " ")} · {job.status} · {job.rowCount.toLocaleString()} {t.rows}{job.errorMessage ? ` · ${job.errorMessage}` : ""}</p></div>
          {job.status === "completed" ? <button type="button" onClick={() => void download(job.id)}>{t.download}</button> : <span className="roleBadge">{job.status}</span>}
        </div>) : <p className="settingsHint">{props.locale === "ar" ? "لا توجد عمليات تصدير بعد." : "No exports yet."}</p>}
      </div>
    </section>

    <section className="panel settingsPanel">
      <h2>{t.retention}</h2><p className="settingsHint">{t.retentionHelp}</p>
      <div className="settingsFields dataRetentionFields">
        {([
          ["rawWebhookDays", t.webhook], ["importFileDays", t.import], ["exportFileHours", t.exportHours], ["auditLogDays", t.audit], ["campaignRecipientDays", t.recipients],
        ] as const).map(([key, label]) => <label key={key}><span>{label}</span><input type="number" min={1} disabled={!props.canManageRetention} value={retention[key]} onChange={(event) => setRetention((current) => ({ ...current, [key]: Number(event.target.value) }))} /></label>)}
      </div>
      {props.canManageRetention ? <button className="primary dataSaveButton" disabled={busy} onClick={() => void saveRetention()}>{t.save}</button> : null}
    </section>

    <section className="panel settingsPanel dangerPanel">
      <h2>{t.danger}</h2><p className="settingsHint">{t.reauth}</p>
      <div className="dangerBlock">
        <strong>{t.deleteWorkspace}</strong><p>{t.deleteWorkspaceHelp}</p>
        {deletion && deletion.status !== "cancelled" ? <div className="settingsCallout"><strong>{deletion.status}</strong><p>{props.locale === "ar" ? "تنتهي مهلة التراجع:" : "Cooling-off ends:"} {new Date(deletion.coolingOffEndsAt).toLocaleString()} · {props.locale === "ar" ? "موعد الحذف النهائي:" : "Purge after:"} {new Date(deletion.purgeAfter).toLocaleString()}</p>{deletion.status === "cooling_off" && props.canDeleteWorkspace ? <button onClick={() => void cancelDeletion()} disabled={busy}>{t.cancel}</button> : null}</div> : null}
        {props.canDeleteWorkspace && !deletion ? <><label><span>{props.workspaceSlug}</span><input value={workspaceConfirmation} onChange={(event) => setWorkspaceConfirmation(event.target.value)} placeholder={props.workspaceSlug} autoComplete="off" /></label><label className="destructiveCheck"><input type="checkbox" checked={acknowledge} onChange={(event) => setAcknowledge(event.target.checked)} /><span>{t.acknowledge}</span></label><button className="dangerButton" disabled={busy || workspaceConfirmation !== props.workspaceSlug || !acknowledge} onClick={() => void scheduleDeletion()}>{t.schedule}</button></> : null}
      </div>
      <div className="dangerBlock">
        <strong>{t.account}</strong><p>{t.accountHelp}</p>
        <label><span>DELETE ACCOUNT</span><input value={accountConfirmation} onChange={(event) => setAccountConfirmation(event.target.value)} placeholder="DELETE ACCOUNT" autoComplete="off" /></label>
        <DestructiveConfirmDialog
          triggerLabel={t.deleteAccount}
          title={t.confirmAccountTitle}
          description={t.confirmAccountDescription}
          confirmLabel={t.confirmAccountAction}
          cancelLabel={t.cancelAction}
          disabled={busy || accountConfirmation !== "DELETE ACCOUNT"}
          onConfirm={deleteAccount}
        />
      </div>
    </section>
  </div>;
}