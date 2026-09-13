import Link from "next/link";
import { and, count, desc, eq } from "drizzle-orm";
import { schema } from "@wa/db";
import { AppSidebar } from "@/components/app-sidebar";
import { ConnectWhatsApp } from "@/components/connect-whatsapp";
import { ContactImporter } from "@/components/contact-importer";
import { requireAuthContext } from "@/lib/auth-context";
import { getI18n } from "@/lib/i18n/server";
import { db, getMetaServerConfig } from "@/lib/server";
import { can } from "@/lib/workspace-access";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { session, workspace } = await requireAuthContext();
  const { messages, localeTag } = await getI18n();
  const number = new Intl.NumberFormat(localeTag);
  const meta = getMetaServerConfig();

  const [phoneNumbers, contactRows, campaignRows, importRows, approvedTemplateRows] = await Promise.all([
    db.select().from(schema.whatsappPhoneNumbers).where(eq(schema.whatsappPhoneNumbers.organizationId, workspace.organizationId)).orderBy(desc(schema.whatsappPhoneNumbers.createdAt)),
    db.select({ total: count() }).from(schema.contacts).where(eq(schema.contacts.organizationId, workspace.organizationId)),
    db.select({ total: count() }).from(schema.campaigns).where(eq(schema.campaigns.organizationId, workspace.organizationId)),
    db.select().from(schema.contactImports).where(eq(schema.contactImports.organizationId, workspace.organizationId)).orderBy(desc(schema.contactImports.createdAt)).limit(1),
    db.select({ total: count() }).from(schema.templates).where(and(eq(schema.templates.organizationId, workspace.organizationId), eq(schema.templates.status, "approved"))),
  ]);

  const connected = phoneNumbers.find((phone) => phone.status === "connected");
  const contacts = contactRows[0]?.total ?? 0;
  const campaigns = campaignRows[0]?.total ?? 0;
  const approvedTemplates = approvedTemplateRows[0]?.total ?? 0;
  const latestImport = importRows[0];
  const importSnapshot = latestImport ? {
    id: latestImport.id, fileName: latestImport.originalFileName, status: latestImport.status,
    totalRows: latestImport.totalRows, processedRows: latestImport.processedRows,
    importedRows: latestImport.importedRows, invalidRows: latestImport.invalidRows,
    duplicateRows: latestImport.duplicateRows, errorMessage: latestImport.errorMessage,
  } : null;
  const initials = workspace.organizationName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const readyToCampaign = Boolean(connected && contacts > 0 && approvedTemplates > 0);
  const canManageWhatsApp = can(workspace.role, "whatsapp.manage");
  const stats = [
    { label: messages.nav.contacts, value: number.format(contacts), detail: contacts ? messages.ui.contactsInWorkspace : messages.ui.importFirstAudience },
    { label: messages.nav.campaigns, value: number.format(campaigns), detail: campaigns ? messages.ui.campaignsCreated : messages.ui.noCampaignsSent },
    { label: messages.ui.whatsappNumbers, value: number.format(phoneNumbers.length), detail: connected ? messages.ui.numberReady : messages.ui.connectBusinessNumber },
    { label: messages.ui.throughput, value: connected ? `${number.format(connected.throughputMps)} msg/s` : "—", detail: messages.ui.syncedFromNumber },
  ];

  return (
    <main className="shell">
      <AppSidebar active="overview" workspaceName={workspace.organizationName} email={session.user.email} initials={initials} />
      <section className="content">
        <header className="topbar">
          <div><p className="eyebrow">{messages.nav.overview}</p><h1>{workspace.organizationName}</h1><p className="subtitle">{messages.ui.dashboardSubtitle}</p></div>
          {readyToCampaign ? <Link className="primary" href="/campaigns">{messages.ui.createCampaign}</Link> : <button className="primary" disabled type="button">{messages.ui.createCampaign}</button>}
        </header>

        <section className="connectionCard">
          <div className="connectionIcon">W</div>
          <div className="connectionCopy">
            <div className="rowTitle"><h2>{connected ? messages.ui.whatsappConnected : messages.ui.connectWhatsappBusiness}</h2><span className={connected ? "status connected" : "status"}>{connected ? messages.common.connected : messages.common.notConnected}</span></div>
            {connected ? <p>{connected.verifiedName ?? messages.common.whatsappBusiness} · {connected.displayPhoneNumber ?? connected.phoneNumberId}{connected.qualityRating ? ` · ${messages.ui.quality} ${connected.qualityRating}` : ""}</p> : <p>{messages.ui.connectDescription}</p>}
          </div>
          {canManageWhatsApp ? <ConnectWhatsApp appId={meta.appId} configId={meta.configId} graphApiVersion={meta.graphApiVersion} /> : null}
        </section>

        <section className="statsGrid" aria-label={messages.ui.workspaceStatistics}>{stats.map((stat) => <article className="statCard" key={stat.label}><span>{stat.label}</span><strong>{stat.value}</strong><p>{stat.detail}</p></article>)}</section>

        <section className="panel" id="contacts" style={{ marginTop: 18 }}>
          <div className="panelHeader"><div><p className="eyebrow">{messages.nav.contacts}</p><h2>{messages.ui.importOptedIn}</h2><p className="subtitle">{messages.ui.importDescription} <Link href="/contacts">{messages.ui.reviewConsent}</Link>.</p></div></div>
          <ContactImporter initialImport={importSnapshot} />
        </section>

        <section className="mainGrid">
          <article className="panel campaignsPanel">
            <div className="panelHeader"><div><p className="eyebrow">{messages.ui.whatsappSetup}</p><h2>{phoneNumbers.length ? messages.ui.connectedNumbers : messages.ui.noNumberConnected}</h2></div></div>
            {phoneNumbers.length ? <div className="numberList">{phoneNumbers.map((phone) => (
              <div className="numberRow" key={phone.id}><div><strong>{phone.verifiedName ?? messages.common.whatsappBusiness}</strong><p>{phone.displayPhoneNumber ?? phone.phoneNumberId}</p></div><div className="numberMeta"><span>{number.format(phone.throughputMps)} msg/s</span><span className={phone.status === "connected" ? "status connected" : "status"}>{phone.status === "connected" ? messages.common.connected : phone.status}</span></div></div>
            ))}</div> : <div className="emptyState"><div className="emptyIcon">W</div><h3>{messages.ui.connectFirstNumber}</h3><p>{messages.ui.metaIdentityDescription}</p></div>}
          </article>

          <aside className="panel readinessPanel">
            <p className="eyebrow">{messages.ui.launchChecklist}</p><h2>{messages.ui.getReadyToSend}</h2>
            <ol className="checklist">
              <li><span>{connected ? "✓" : "1"}</span><div><strong>{messages.ui.connectWhatsapp}</strong><p>{messages.ui.embeddedSignup}</p></div></li>
              <li><span>{contacts > 0 ? "✓" : "2"}</span><div><strong>{messages.ui.importContacts}</strong><p>{messages.ui.optedInOnly}</p></div></li>
              <li><span>{approvedTemplates > 0 ? "✓" : "3"}</span><div><strong>{messages.ui.syncTemplate}</strong><p>{approvedTemplates > 0 ? messages.ui.approvedTemplatesCount.replace("{count}", number.format(approvedTemplates)) : messages.ui.approvedMarketingTemplate}</p></div></li>
              <li><span>{readyToCampaign ? "✓" : "4"}</span><div><strong>{messages.ui.launchSafely}</strong><p>{readyToCampaign ? messages.ui.campaignEngineReady : messages.ui.workersRespectThroughput}</p></div></li>
            </ol>
          </aside>
        </section>
      </section>
    </main>
  );
}
