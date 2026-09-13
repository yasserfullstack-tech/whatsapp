import Link from "next/link";
import { count, desc, eq } from "drizzle-orm";
import { schema } from "@wa/db";
import { AppSidebar } from "@/components/app-sidebar";
import { AudienceManager } from "@/components/audience-manager";
import { FirstUseEmptyState } from "@/components/first-use-empty-state";
import { requireAuthContext } from "@/lib/auth-context";
import { countEligibleAudience } from "@/lib/audience-server";
import { getI18n } from "@/lib/i18n/server";
import { db } from "@/lib/server";

export const dynamic = "force-dynamic";

export default async function AudiencesPage() {
  const { session, workspace } = await requireAuthContext();
  const { messages, localeTag, locale } = await getI18n();
  const number = new Intl.NumberFormat(localeTag);
  const date = new Intl.DateTimeFormat(localeTag, { dateStyle: "medium" });
  const organizationId = workspace.organizationId;
  const [listRows, segments] = await Promise.all([
    db.select({ id: schema.contactLists.id, name: schema.contactLists.name, description: schema.contactLists.description, createdAt: schema.contactLists.createdAt, memberCount: count(schema.contactListMembers.id) }).from(schema.contactLists).leftJoin(schema.contactListMembers, eq(schema.contactLists.id, schema.contactListMembers.listId)).where(eq(schema.contactLists.organizationId, organizationId)).groupBy(schema.contactLists.id).orderBy(desc(schema.contactLists.createdAt)),
    db.select().from(schema.audienceSegments).where(eq(schema.audienceSegments.organizationId, organizationId)).orderBy(desc(schema.audienceSegments.updatedAt)),
  ]);
  const segmentCounts = new Map<string, number>();
  await Promise.all(segments.map(async (segment) => segmentCounts.set(segment.id, await countEligibleAudience(organizationId, { type: "segment", match: segment.match, filters: segment.filters }))));
  const initials = workspace.organizationName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

  return <main className="shell">
    <AppSidebar active="audiences" workspaceName={workspace.organizationName} email={session.user.email} initials={initials} />
    <section className="content">
      <header className="topbar"><div><p className="eyebrow">{messages.nav.audiences}</p><h1>{messages.ui.audiencesTitle}</h1><p className="subtitle">{messages.ui.audiencesSubtitle}</p></div><Link className="secondary" href="/dashboard#contacts">{messages.ui.importList}</Link></header>
      <section className="statsGrid" aria-label={messages.ui.audienceStats}>
        <article className="statCard"><span>{messages.ui.lists}</span><strong>{number.format(listRows.length)}</strong><p>{messages.ui.explicitMemberships}</p></article>
        <article className="statCard"><span>{messages.ui.segments}</span><strong>{number.format(segments.length)}</strong><p>{messages.ui.savedDynamicFilters}</p></article>
        <article className="statCard"><span>{messages.ui.listMemberships}</span><strong>{number.format(listRows.reduce((sum, list) => sum + list.memberCount, 0))}</strong><p>{messages.ui.acrossLists}</p></article>
        <article className="statCard"><span>{messages.ui.safety}</span><strong>{messages.ui.alwaysOn}</strong><p>{messages.ui.optOutSafety}</p></article>
      </section>
      {listRows.length === 0 && segments.length === 0 ? <FirstUseEmptyState kind="audiences" locale={locale} /> : null}
      <section className="panel" style={{ marginTop: 18 }}><div className="panelHeader"><div><p className="eyebrow">{messages.ui.dynamicSegment}</p><h2>{messages.ui.buildFilters}</h2><p className="subtitle">{messages.ui.filterDescription}</p></div></div><AudienceManager lists={listRows.map((list) => ({ id: list.id, name: list.name, memberCount: list.memberCount }))} /></section>
      <section className="mainGrid">
        <article className="panel campaignsPanel"><div className="panelHeader"><div><p className="eyebrow">{messages.ui.staticLists}</p><h2>{listRows.length ? messages.ui.importedAudiences : messages.ui.noLists}</h2></div></div>
          {listRows.length ? <div className="numberList">{listRows.map((list) => <div className="numberRow" key={list.id}><div><strong>{list.name}</strong><p>{list.description ?? messages.ui.createdFromImports}</p></div><div className="numberMeta"><span>{number.format(list.memberCount)} {messages.ui.members}</span><span>{date.format(list.createdAt)}</span></div></div>)}</div> : <div className="emptyState"><div className="emptyIcon">L</div><h3>{messages.ui.importIntoList}</h3><p>{messages.ui.importIntoListDescription}</p></div>}
        </article>
        <aside className="panel readinessPanel"><p className="eyebrow">{messages.ui.savedSegments}</p><h2>{segments.length ? messages.ui.readyForCampaigns : messages.ui.noSegments}</h2>
          {segments.length ? <div className="numberList">{segments.map((segment) => <div className="numberRow" key={segment.id}><div><strong>{segment.name}</strong><p>{messages.ui.filterCount.replace("{count}", number.format(segment.filters.length))} · {segment.match === "all" ? "AND" : "OR"}</p></div><div className="numberMeta"><span>{messages.ui.eligibleCountNow.replace("{count}", number.format(segmentCounts.get(segment.id) ?? 0))}</span></div></div>)}</div> : <p className="subtitle">{messages.ui.buildSegmentHint}</p>}
        </aside>
      </section>
    </section>
  </main>;
}
