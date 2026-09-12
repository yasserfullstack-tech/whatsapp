import Link from "next/link";
import { count, desc, eq } from "drizzle-orm";
import { schema } from "@wa/db";
import { AudienceManager } from "@/components/audience-manager";
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

export default async function AudiencesPage() {
  const { session, workspace } = await requireAuthContext();
  const organizationId = workspace.organizationId;
  const [listRows, segments] = await Promise.all([
    db.select({
      id: schema.contactLists.id,
      name: schema.contactLists.name,
      description: schema.contactLists.description,
      createdAt: schema.contactLists.createdAt,
      memberCount: count(schema.contactListMembers.id),
    })
      .from(schema.contactLists)
      .leftJoin(schema.contactListMembers, eq(schema.contactLists.id, schema.contactListMembers.listId))
      .where(eq(schema.contactLists.organizationId, organizationId))
      .groupBy(schema.contactLists.id)
      .orderBy(desc(schema.contactLists.createdAt)),
    db.select().from(schema.audienceSegments)
      .where(eq(schema.audienceSegments.organizationId, organizationId))
      .orderBy(desc(schema.audienceSegments.updatedAt)),
  ]);

  const segmentCounts = new Map<string, number>();
  await Promise.all(segments.map(async (segment) => {
    const total = await countEligibleAudience(organizationId, { type: "segment", match: segment.match, filters: segment.filters });
    segmentCounts.set(segment.id, total);
  }));

  const initials = workspace.organizationName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><div className="brandMark">W</div><div><strong>WhatsApp</strong><span>Campaigns</span></div></div>
        <nav className="nav" aria-label="Primary navigation">
          {nav.map((item) => (
            <Link className={item.label === "Audiences" ? "navItem active" : "navItem"} href={item.href} key={item.label}>
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
          <div><p className="eyebrow">Audiences</p><h1>Lists and reusable segments</h1><p className="subtitle">Lists freeze explicit membership. Segments evaluate saved filters against current eligible contacts when a campaign launches.</p></div>
          <Link className="secondary" href="/dashboard#contacts">Import a list</Link>
        </header>

        <section className="statsGrid" aria-label="Audience statistics">
          <article className="statCard"><span>Lists</span><strong>{listRows.length.toLocaleString()}</strong><p>Explicit contact memberships</p></article>
          <article className="statCard"><span>Segments</span><strong>{segments.length.toLocaleString()}</strong><p>Saved dynamic filters</p></article>
          <article className="statCard"><span>List memberships</span><strong>{listRows.reduce((sum, list) => sum + list.memberCount, 0).toLocaleString()}</strong><p>Across all workspace lists</p></article>
          <article className="statCard"><span>Safety</span><strong>Always on</strong><p>Opt-out and suppression applied at launch</p></article>
        </section>

        <section className="panel" style={{ marginTop: 18 }}>
          <div className="panelHeader"><div><p className="eyebrow">Dynamic segment</p><h2>Build with AND / OR filters</h2><p className="subtitle">Filter by list membership, contact name, or E.164 phone prefix/suffix. Preview uses the same SQL rules as campaign snapshots.</p></div></div>
          <AudienceManager lists={listRows.map((list) => ({ id: list.id, name: list.name, memberCount: list.memberCount }))} />
        </section>

        <section className="mainGrid">
          <article className="panel campaignsPanel">
            <div className="panelHeader"><div><p className="eyebrow">Static lists</p><h2>{listRows.length ? "Imported audiences" : "No lists yet"}</h2></div></div>
            {listRows.length ? <div className="numberList">{listRows.map((list) => (
              <div className="numberRow" key={list.id}>
                <div><strong>{list.name}</strong><p>{list.description ?? "Created from contact imports"}</p></div>
                <div className="numberMeta"><span>{list.memberCount.toLocaleString()} members</span><span>{list.createdAt.toLocaleDateString()}</span></div>
              </div>
            ))}</div> : <div className="emptyState"><div className="emptyIcon">L</div><h3>Import contacts into a list</h3><p>Use the optional list name on the CSV importer. Existing contacts are added too; they are not duplicated.</p></div>}
          </article>

          <aside className="panel readinessPanel">
            <p className="eyebrow">Saved segments</p><h2>{segments.length ? "Ready for campaigns" : "No segments yet"}</h2>
            {segments.length ? <div className="numberList">{segments.map((segment) => (
              <div className="numberRow" key={segment.id}>
                <div><strong>{segment.name}</strong><p>{segment.filters.length} filter{segment.filters.length === 1 ? "" : "s"} · {segment.match === "all" ? "AND" : "OR"}</p></div>
                <div className="numberMeta"><span>{(segmentCounts.get(segment.id) ?? 0).toLocaleString()} eligible now</span></div>
              </div>
            ))}</div> : <p className="subtitle">Build a reusable segment above. Counts are recalculated against current opt-in/suppression state.</p>}
          </aside>
        </section>
      </section>
    </main>
  );
}
