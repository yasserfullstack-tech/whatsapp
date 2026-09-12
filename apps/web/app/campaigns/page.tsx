import Link from "next/link";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { schema } from "@wa/db";
import { CampaignBuilder } from "@/components/campaign-builder";
import { SignOutButton } from "@/components/sign-out-button";
import { requireAuthContext } from "@/lib/auth-context";
import { db } from "@/lib/server";

export const dynamic = "force-dynamic";

const nav = [
  { label: "Overview", href: "/dashboard" },
  { label: "Contacts", href: "/dashboard#contacts" },
  { label: "Templates", href: "/templates" },
  { label: "Campaigns", href: "/campaigns" },
  { label: "Reports", href: "/campaigns" },
  { label: "Settings", href: "/dashboard" },
];

function variableIndexes(body: string): number[] {
  return [...new Set([...body.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1])))]
    .filter((value) => Number.isInteger(value) && value > 0)
    .sort((a, b) => a - b);
}

function isTextOnly(components: unknown): boolean {
  if (!Array.isArray(components)) return true;
  return components.every((component) => {
    if (!component || typeof component !== "object") return false;
    const type = String((component as Record<string, unknown>).type ?? "").toUpperCase();
    return type === "BODY" || type === "FOOTER";
  });
}

export default async function CampaignsPage() {
  const { session, workspace } = await requireAuthContext();
  const organizationId = workspace.organizationId;
  const [phones, templateRows, eligibleRows, campaigns] = await Promise.all([
    db.select().from(schema.whatsappPhoneNumbers)
      .where(and(eq(schema.whatsappPhoneNumbers.organizationId, organizationId), eq(schema.whatsappPhoneNumbers.status, "connected")))
      .orderBy(desc(schema.whatsappPhoneNumbers.createdAt)),
    db.select().from(schema.templates)
      .where(and(eq(schema.templates.organizationId, organizationId), eq(schema.templates.status, "approved")))
      .orderBy(desc(schema.templates.updatedAt)),
    db.select({ total: count() }).from(schema.contacts)
      .where(and(eq(schema.contacts.organizationId, organizationId), eq(schema.contacts.optedIn, true), isNull(schema.contacts.unsubscribedAt))),
    db.select().from(schema.campaigns)
      .where(eq(schema.campaigns.organizationId, organizationId))
      .orderBy(desc(schema.campaigns.createdAt))
      .limit(20),
  ]);

  const templates = templateRows.filter((template) => template.bodyPreview && isTextOnly(template.components));
  const eligibleContacts = eligibleRows[0]?.total ?? 0;
  const initials = workspace.organizationName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const active = campaigns.filter((campaign) => campaign.status === "dispatching" || campaign.status === "sending").length;
  const completed = campaigns.filter((campaign) => campaign.status === "completed").length;

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><div className="brandMark">W</div><div><strong>WhatsApp</strong><span>Campaigns</span></div></div>
        <nav className="nav" aria-label="Primary navigation">
          {nav.map((item) => (
            <Link className={item.label === "Campaigns" ? "navItem active" : "navItem"} href={item.href} key={item.label}>
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
          <div><p className="eyebrow">Campaigns</p><h1>Launch a WhatsApp campaign</h1><p className="subtitle">The audience snapshot lives in PostgreSQL while Redis holds only a small throughput-sized sending runway.</p></div>
        </header>

        <section className="statsGrid" aria-label="Campaign statistics">
          <article className="statCard"><span>Eligible contacts</span><strong>{eligibleContacts.toLocaleString()}</strong><p>Opted in and not unsubscribed</p></article>
          <article className="statCard"><span>Campaigns</span><strong>{campaigns.length.toLocaleString()}</strong><p>Latest 20 in this workspace</p></article>
          <article className="statCard"><span>Active</span><strong>{active.toLocaleString()}</strong><p>Dispatching or sending</p></article>
          <article className="statCard"><span>Completed</span><strong>{completed.toLocaleString()}</strong><p>Submission pass completed</p></article>
        </section>

        <section className="panel" style={{ marginTop: 18 }}>
          <div className="panelHeader"><div><p className="eyebrow">New campaign</p><h2>All eligible contacts</h2><p className="subtitle">This first audience mode targets every opted-in contact. Lists/segments can layer on the same snapshot engine later.</p></div></div>
          <CampaignBuilder
            eligibleContacts={eligibleContacts}
            phones={phones.map((phone) => ({
              id: phone.id,
              wabaId: phone.wabaId,
              label: `${phone.verifiedName ?? "WhatsApp Business"} · ${phone.displayPhoneNumber ?? phone.phoneNumberId}`,
              throughputMps: phone.throughputMps,
            }))}
            templates={templates.map((template) => ({
              id: template.id,
              wabaId: template.wabaId,
              name: template.name,
              language: template.language,
              bodyPreview: template.bodyPreview ?? "",
              variableIndexes: variableIndexes(template.bodyPreview ?? ""),
            }))}
          />
        </section>

        <section className="panel" style={{ marginTop: 18 }}>
          <div className="panelHeader"><div><p className="eyebrow">History</p><h2>Recent campaigns</h2><p className="subtitle">Open a campaign to watch sent, delivered, read, and failure status updates from Meta.</p></div></div>
          {campaigns.length ? (
            <div className="numberList" style={{ marginTop: 14 }}>
              {campaigns.map((campaign) => (
                <div className="numberRow" key={campaign.id}>
                  <div>
                    <Link href={`/campaigns/${campaign.id}`} style={{ fontWeight: 700 }}>{campaign.name}</Link>
                    <p>{campaign.recipientCount ? `${campaign.recipientCount.toLocaleString()} snapshotted recipients` : "Preparing recipient snapshot"}</p>
                  </div>
                  <div className="numberMeta">
                    <span>{campaign.createdAt.toLocaleString()}</span>
                    <span className={campaign.status === "completed" ? "status connected" : "status"}>{campaign.status}</span>
                    <Link href={`/campaigns/${campaign.id}`}>View analytics →</Link>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="emptyState" style={{ marginTop: 14 }}><div className="emptyIcon">C</div><h3>No campaigns yet</h3><p>Your first campaign will create an immutable recipient snapshot before queueing sends.</p></div>
          )}
        </section>
      </section>
    </main>
  );
}
