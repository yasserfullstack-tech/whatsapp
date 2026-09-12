import Link from "next/link";
import { and, count, desc, eq } from "drizzle-orm";
import { schema } from "@wa/db";
import { ConnectWhatsApp } from "@/components/connect-whatsapp";
import { ContactImporter } from "@/components/contact-importer";
import { SignOutButton } from "@/components/sign-out-button";
import { requireAuthContext } from "@/lib/auth-context";
import { db, getMetaServerConfig } from "@/lib/server";

export const dynamic = "force-dynamic";

const nav = [
  { label: "Overview", href: "/dashboard" },
  { label: "Contacts", href: "/dashboard#contacts" },
  { label: "Templates", href: "/templates" },
  { label: "Campaigns", href: "/dashboard" },
  { label: "Reports", href: "/dashboard" },
  { label: "Settings", href: "/dashboard" },
];

export default async function DashboardPage() {
  const { session, workspace } = await requireAuthContext();
  const meta = getMetaServerConfig();

  const [phoneNumbers, contactRows, campaignRows, importRows, approvedTemplateRows] = await Promise.all([
    db.select().from(schema.whatsappPhoneNumbers)
      .where(eq(schema.whatsappPhoneNumbers.organizationId, workspace.organizationId))
      .orderBy(desc(schema.whatsappPhoneNumbers.createdAt)),
    db.select({ total: count() }).from(schema.contacts)
      .where(eq(schema.contacts.organizationId, workspace.organizationId)),
    db.select({ total: count() }).from(schema.campaigns)
      .where(eq(schema.campaigns.organizationId, workspace.organizationId)),
    db.select().from(schema.contactImports)
      .where(eq(schema.contactImports.organizationId, workspace.organizationId))
      .orderBy(desc(schema.contactImports.createdAt)).limit(1),
    db.select({ total: count() }).from(schema.templates)
      .where(and(eq(schema.templates.organizationId, workspace.organizationId), eq(schema.templates.status, "approved"))),
  ]);

  const connected = phoneNumbers.find((phone) => phone.status === "connected");
  const contacts = contactRows[0]?.total ?? 0;
  const campaigns = campaignRows[0]?.total ?? 0;
  const approvedTemplates = approvedTemplateRows[0]?.total ?? 0;
  const latestImport = importRows[0];
  const importSnapshot = latestImport ? {
    id: latestImport.id,
    fileName: latestImport.originalFileName,
    status: latestImport.status,
    totalRows: latestImport.totalRows,
    processedRows: latestImport.processedRows,
    importedRows: latestImport.importedRows,
    invalidRows: latestImport.invalidRows,
    duplicateRows: latestImport.duplicateRows,
    errorMessage: latestImport.errorMessage,
  } : null;

  const initials = workspace.organizationName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const stats = [
    { label: "Contacts", value: contacts.toLocaleString(), detail: contacts ? "Contacts in this workspace" : "Import your first audience" },
    { label: "Campaigns", value: campaigns.toLocaleString(), detail: campaigns ? "Campaigns created" : "No campaigns sent yet" },
    { label: "WhatsApp numbers", value: phoneNumbers.length.toLocaleString(), detail: connected ? "At least one number is ready" : "Connect a business number" },
    { label: "Throughput", value: connected ? `${connected.throughputMps} msg/s` : "—", detail: "Synced from the connected number" },
  ];

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><div className="brandMark">W</div><div><strong>WhatsApp</strong><span>Campaigns</span></div></div>
        <nav className="nav" aria-label="Primary navigation">
          {nav.map((item) => (
            <Link className={item.label === "Overview" ? "navItem active" : "navItem"} href={item.href} key={item.label}>
              <span className="navDot" aria-hidden="true" />{item.label}
            </Link>
          ))}
        </nav>
        <div className="workspace">
          <div className="workspaceAvatar">{initials || "W"}</div>
          <div className="workspaceMeta"><strong>{workspace.organizationName}</strong><span>{session.user.email}</span></div>
          <SignOutButton />
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div><p className="eyebrow">Overview</p><h1>{workspace.organizationName}</h1><p className="subtitle">Connect WhatsApp, import opted-in customers, and launch campaigns.</p></div>
          <button className="primary" disabled={!connected || contacts === 0 || approvedTemplates === 0} type="button">Create campaign</button>
        </header>

        <section className="connectionCard">
          <div className="connectionIcon">W</div>
          <div className="connectionCopy">
            <div className="rowTitle"><h2>{connected ? "WhatsApp Business connected" : "Connect WhatsApp Business"}</h2><span className={connected ? "status connected" : "status"}>{connected ? "Connected" : "Not connected"}</span></div>
            {connected ? <p>{connected.verifiedName ?? "WhatsApp Business"} · {connected.displayPhoneNumber ?? connected.phoneNumberId}{connected.qualityRating ? ` · Quality ${connected.qualityRating}` : ""}</p> : <p>The client signs into Meta in a popup and selects their business, WABA, and phone number. No API tokens or IDs need to be copied into this app.</p>}
          </div>
          <ConnectWhatsApp appId={meta.appId} configId={meta.configId} graphApiVersion={meta.graphApiVersion} />
        </section>

        <section className="statsGrid" aria-label="Workspace statistics">
          {stats.map((stat) => <article className="statCard" key={stat.label}><span>{stat.label}</span><strong>{stat.value}</strong><p>{stat.detail}</p></article>)}
        </section>

        <section className="panel" id="contacts" style={{ marginTop: 18 }}>
          <div className="panelHeader"><div><p className="eyebrow">Contacts</p><h2>Import opted-in customers</h2><p className="subtitle">CSV files upload directly to R2 and are processed by a background worker in 1,000-row database batches.</p></div></div>
          <ContactImporter initialImport={importSnapshot} />
        </section>

        <section className="mainGrid">
          <article className="panel campaignsPanel">
            <div className="panelHeader"><div><p className="eyebrow">WhatsApp setup</p><h2>{phoneNumbers.length ? "Connected numbers" : "No number connected yet"}</h2></div></div>
            {phoneNumbers.length ? <div className="numberList">{phoneNumbers.map((phone) => (
              <div className="numberRow" key={phone.id}><div><strong>{phone.verifiedName ?? "WhatsApp Business"}</strong><p>{phone.displayPhoneNumber ?? phone.phoneNumberId}</p></div><div className="numberMeta"><span>{phone.throughputMps} msg/s</span><span className={phone.status === "connected" ? "status connected" : "status"}>{phone.status}</span></div></div>
            ))}</div> : <div className="emptyState"><div className="emptyIcon">W</div><h3>Connect the first client number</h3><p>Meta remains the owner/identity layer. After Embedded Signup finishes, normal work stays inside this dashboard.</p></div>}
          </article>

          <aside className="panel readinessPanel">
            <p className="eyebrow">Launch checklist</p><h2>Get ready to send</h2>
            <ol className="checklist">
              <li><span>{connected ? "✓" : "1"}</span><div><strong>Connect WhatsApp</strong><p>Meta Embedded Signup.</p></div></li>
              <li><span>{contacts > 0 ? "✓" : "2"}</span><div><strong>Import contacts</strong><p>Only opted-in WhatsApp recipients.</p></div></li>
              <li><span>{approvedTemplates > 0 ? "✓" : "3"}</span><div><strong>Sync a template</strong><p>{approvedTemplates > 0 ? `${approvedTemplates} approved template${approvedTemplates === 1 ? "" : "s"}.` : "Use an approved marketing template."}</p></div></li>
              <li><span>4</span><div><strong>Launch safely</strong><p>Workers respect each phone number&apos;s throughput.</p></div></li>
            </ol>
          </aside>
        </section>
      </section>
    </main>
  );
}
