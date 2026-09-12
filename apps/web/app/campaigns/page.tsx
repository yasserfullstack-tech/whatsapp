import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { schema } from "@wa/db";
import { CampaignBuilder } from "@/components/campaign-builder";
import { SignOutButton } from "@/components/sign-out-button";
import { requireAuthContext } from "@/lib/auth-context";
import { countEligibleAudience } from "@/lib/audience-server";
import { db } from "@/lib/server";

export const dynamic = "force-dynamic";

const nav = [
  { label: "Overview", href: "/dashboard" },
  { label: "Contacts", href: "/contacts" },
  { label: "Audiences", href: "/audiences" },
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
  const [phones, templateRows, campaigns, lists, segments] = await Promise.all([
    db.select().from(schema.whatsappPhoneNumbers)
      .where(and(eq(schema.whatsappPhoneNumbers.organizationId, organizationId), eq(schema.whatsappPhoneNumbers.status, "connected")))
      .orderBy(desc(schema.whatsappPhoneNumbers.createdAt)),
    db.select().from(schema.templates)
      .where(and(eq(schema.templates.organizationId, organizationId), eq(schema.templates.status, "approved")))
      .orderBy(desc(schema.templates.updatedAt)),
    db.select().from(schema.campaigns)
      .where(eq(schema.campaigns.organizationId, organizationId))
      .orderBy(desc(schema.campaigns.createdAt))
      .limit(20),
    db.select().from(schema.contactLists)
      .where(eq(schema.contactLists.organizationId, organizationId))
      .orderBy(desc(schema.contactLists.updatedAt)),
    db.select().from(schema.audienceSegments)
      .where(eq(schema.audienceSegments.organizationId, organizationId))
      .orderBy(desc(schema.audienceSegments.updatedAt)),
  ]);

  const allEligible = await countEligibleAudience(organizationId, { type: "all" });
  const [listCounts, segmentCounts] = await Promise.all([
    Promise.all(lists.map((list) => countEligibleAudience(organizationId, { type: "list", listId: list.id }))),
    Promise.all(segments.map((segment) => countEligibleAudience(organizationId, { type: "segment", match: segment.match, filters: segment.filters }))),
  ]);

  const audiences = [
    { key: "all", type: "all" as const, name: "All eligible contacts", count: allEligible },
    ...lists.map((list, index) => ({ key: `list:${list.id}`, type: "list" as const, id: list.id, name: `List · ${list.name}`, count: listCounts[index] ?? 0 })),
    ...segments.map((segment, index) => ({ key: `segment:${segment.id}`, type: "segment" as const, id: segment.id, name: `Segment · ${segment.name}`, count: segmentCounts[index] ?? 0 })),
  ];

  const templates = templateRows.filter((template) => template.bodyPreview && isTextOnly(template.components));
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
          <div><p className="eyebrow">Campaigns</p><h1>Launch a WhatsApp campaign</h1><p className="subtitle">Choose all eligible contacts, a static list, or a saved dynamic segment. PostgreSQL freezes the final audience at launch.</p></div>
          <Link className="secondary" href="/audiences">Manage audiences</Link>
        </header>

        <section className="statsGrid" aria-label="Campaign statistics">
          <article className="statCard"><span>Eligible contacts</span><strong>{allEligible.toLocaleString()}</strong><p>Opted in, unsubscribed excluded, suppression applied</p></article>
          <article className="statCard"><span>Audiences</span><strong>{(lists.length + segments.length).toLocaleString()}</strong><p>{lists.length} lists · {segments.length} segments</p></article>
          <article className="statCard"><span>Active</span><strong>{active.toLocaleString()}</strong><p>Dispatching or sending</p></article>
          <article className="statCard"><span>Completed</span><strong>{completed.toLocaleString()}</strong><p>Submission pass completed</p></article>
        </section>

        <section className="panel" style={{ marginTop: 18 }}>
          <div className="panelHeader"><div><p className="eyebrow">New campaign</p><h2>Choose the target audience</h2><p className="subtitle">Counts are calculated with the same eligibility and suppression predicate used by the immutable campaign snapshot.</p></div></div>
          <CampaignBuilder
            audiences={audiences}
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
