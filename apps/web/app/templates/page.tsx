import { desc, eq } from "drizzle-orm";
import { schema } from "@wa/db";
import { AppSidebar } from "@/components/app-sidebar";
import { FirstUseEmptyState } from "@/components/first-use-empty-state";
import { TemplateManager } from "@/components/template-manager";
import { requireAuthContext } from "@/lib/auth-context";
import { getI18n } from "@/lib/i18n/server";
import { listConnectedWabas } from "@/lib/meta-credentials";
import { db } from "@/lib/server";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const { session, workspace } = await requireAuthContext();
  const { messages, localeTag, locale } = await getI18n();
  const number = new Intl.NumberFormat(localeTag);
  const [templates, wabas] = await Promise.all([
    db.select().from(schema.templates).where(eq(schema.templates.organizationId, workspace.organizationId)).orderBy(desc(schema.templates.updatedAt)),
    listConnectedWabas(workspace.organizationId),
  ]);
  const initials = workspace.organizationName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const approved = templates.filter((template) => template.status === "approved").length;
  const pending = templates.filter((template) => template.status === "pending").length;
  const rejected = templates.filter((template) => template.status === "rejected").length;

  return <main className="shell">
    <AppSidebar active="templates" workspaceName={workspace.organizationName} email={session.user.email} initials={initials} />
    <section className="content">
      <header className="topbar"><div><p className="eyebrow">{messages.nav.templates}</p><h1>{messages.ui.templatesTitle}</h1><p className="subtitle">{messages.ui.templatesSubtitle}</p></div></header>
      <section className="statsGrid" aria-label={messages.ui.templateStats}>
        <article className="statCard"><span>{messages.ui.total}</span><strong>{number.format(templates.length)}</strong><p>{messages.ui.acrossWabas}</p></article>
        <article className="statCard"><span>{messages.ui.approved}</span><strong>{number.format(approved)}</strong><p>{messages.ui.readyForCampaignsShort}</p></article>
        <article className="statCard"><span>{messages.ui.pending}</span><strong>{number.format(pending)}</strong><p>{messages.ui.waitingMetaReview}</p></article>
        <article className="statCard"><span>{messages.ui.rejected}</span><strong>{number.format(rejected)}</strong><p>{messages.ui.needsRevision}</p></article>
      </section>
      {templates.length === 0 ? <FirstUseEmptyState kind="templates" locale={locale} /> : null}
      <section className="panel" style={{ marginTop: 18 }}><TemplateManager wabas={wabas.map(({ wabaId, label }) => ({ wabaId, label }))} /></section>
      <section className="panel" style={{ marginTop: 18 }}><div className="panelHeader"><div><p className="eyebrow">{messages.ui.library}</p><h2>{messages.ui.syncedTemplates}</h2></div></div>
        {templates.length ? <div className="numberList" style={{ marginTop: 14 }}>{templates.map((template) => <div className="numberRow" key={template.id} style={{ alignItems: "start" }}><div style={{ minWidth: 0 }}><div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><strong>{template.name}</strong><span className="subtitle">{template.language}</span><span className="subtitle">{template.category}</span></div><p style={{ margin: "7px 0 0", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{template.bodyPreview ?? messages.ui.noBodyPreview}</p>{template.rejectionReason ? <p style={{ margin: "7px 0 0", color: "var(--danger)", fontSize: 12 }}>Meta: {template.rejectionReason}</p> : null}</div><div className="numberMeta"><span className={template.status === "approved" ? "status connected" : "status"}>{template.status}</span><span>WABA {template.wabaId}</span></div></div>)}</div> : <div className="emptyState" style={{ marginTop: 14 }}><div className="emptyIcon">T</div><h3>{messages.ui.noTemplatesSynced}</h3><p>{messages.ui.noTemplatesDescription}</p></div>}
      </section>
    </section>
  </main>;
}
