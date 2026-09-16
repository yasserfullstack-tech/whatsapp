import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { schema } from "@wa/db";
import { analyzeTemplateComponents } from "@wa/meta/templates";
import { AppSidebar } from "@/components/app-sidebar";
import { CampaignBuilder } from "@/components/campaign-builder";
import { requireAuthContext } from "@/lib/auth-context";
import { countEligibleAudience } from "@/lib/audience-server";
import { getI18n } from "@/lib/i18n/server";
import { db } from "@/lib/server";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const { session, workspace } = await requireAuthContext();
  const { messages, localeTag } = await getI18n();
  const number = new Intl.NumberFormat(localeTag);
  const dateTime = new Intl.DateTimeFormat(localeTag, { dateStyle: "medium", timeStyle: "short" });
  const organizationId = workspace.organizationId;
  const [phones, templateRows, campaigns, lists, segments] = await Promise.all([
    db.select().from(schema.whatsappPhoneNumbers).where(and(eq(schema.whatsappPhoneNumbers.organizationId, organizationId), eq(schema.whatsappPhoneNumbers.status, "connected"))).orderBy(desc(schema.whatsappPhoneNumbers.createdAt)),
    db.select().from(schema.templates).where(and(eq(schema.templates.organizationId, organizationId), eq(schema.templates.status, "approved"))).orderBy(desc(schema.templates.updatedAt)),
    db.select().from(schema.campaigns).where(eq(schema.campaigns.organizationId, organizationId)).orderBy(desc(schema.campaigns.createdAt)).limit(20),
    db.select().from(schema.contactLists).where(eq(schema.contactLists.organizationId, organizationId)).orderBy(desc(schema.contactLists.updatedAt)),
    db.select().from(schema.audienceSegments).where(eq(schema.audienceSegments.organizationId, organizationId)).orderBy(desc(schema.audienceSegments.updatedAt)),
  ]);
  const allEligible = await countEligibleAudience(organizationId, { type: "all" });
  const [listCounts, segmentCounts] = await Promise.all([
    Promise.all(lists.map((list) => countEligibleAudience(organizationId, { type: "list", listId: list.id }))),
    Promise.all(segments.map((segment) => countEligibleAudience(organizationId, { type: "segment", match: segment.match, filters: segment.filters }))),
  ]);
  const audiences = [
    { key: "all", type: "all" as const, name: messages.ui.allEligibleContacts, count: allEligible },
    ...lists.map((list, index) => ({ key: `list:${list.id}`, type: "list" as const, id: list.id, name: `${messages.ui.listPrefix} · ${list.name}`, count: listCounts[index] ?? 0 })),
    ...segments.map((segment, index) => ({ key: `segment:${segment.id}`, type: "segment" as const, id: segment.id, name: `${messages.ui.segmentPrefix} · ${segment.name}`, count: segmentCounts[index] ?? 0 })),
  ];
  const templates = templateRows.flatMap((template) => {
    const analysis = analyzeTemplateComponents(template.components);
    if (!analysis.supported) return [];
    return [{
      id: template.id,
      wabaId: template.wabaId,
      name: template.name,
      language: template.language,
      components: template.components,
      slots: analysis.slots,
    }];
  });
  const initials = workspace.organizationName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const active = campaigns.filter((campaign) => campaign.status === "dispatching" || campaign.status === "sending").length;
  const completed = campaigns.filter((campaign) => campaign.status === "completed").length;

  return <main className="shell">
    <AppSidebar active="campaigns" workspaceName={workspace.organizationName} email={session.user.email} initials={initials} />
    <section className="content">
      <header className="topbar"><div><p className="eyebrow">{messages.nav.campaigns}</p><h1>{messages.ui.campaignsTitle}</h1><p className="subtitle">{messages.ui.campaignsSubtitle}</p></div><Link className="secondary" href="/audiences">{messages.ui.manageAudiences}</Link></header>
      <section className="statsGrid" aria-label={messages.ui.campaignStats}>
        <article className="statCard"><span>{messages.ui.eligibleContacts}</span><strong>{number.format(allEligible)}</strong><p>{messages.ui.eligibilityApplied}</p></article>
        <article className="statCard"><span>{messages.ui.audiences}</span><strong>{number.format(lists.length + segments.length)}</strong><p>{messages.ui.audienceBreakdown.replace("{lists}", number.format(lists.length)).replace("{segments}", number.format(segments.length))}</p></article>
        <article className="statCard"><span>{messages.ui.active}</span><strong>{number.format(active)}</strong><p>{messages.ui.dispatchingOrSending}</p></article>
        <article className="statCard"><span>{messages.ui.completed}</span><strong>{number.format(completed)}</strong><p>{messages.ui.submissionCompleted}</p></article>
      </section>
      <section className="panel" style={{ marginTop: 18 }}><div className="panelHeader"><div><p className="eyebrow">{messages.ui.newCampaign}</p><h2>{messages.ui.chooseAudience}</h2><p className="subtitle">{messages.ui.audienceCountDescription}</p></div></div><CampaignBuilder audiences={audiences} phones={phones.map((phone) => ({ id: phone.id, wabaId: phone.wabaId, label: `${phone.verifiedName ?? messages.common.whatsappBusiness} · ${phone.displayPhoneNumber ?? phone.phoneNumberId}`, throughputMps: phone.throughputMps }))} templates={templates} /></section>
      <section className="panel" style={{ marginTop: 18 }}><div className="panelHeader"><div><p className="eyebrow">{messages.ui.history}</p><h2>{messages.ui.recentCampaigns}</h2><p className="subtitle">{messages.ui.campaignHistoryDescription}</p></div></div>
        {campaigns.length ? <div className="numberList" style={{ marginTop: 14 }}>{campaigns.map((campaign) => <div className="numberRow" key={campaign.id}><div><Link href={`/campaigns/${campaign.id}`} style={{ fontWeight: 700 }}>{campaign.name}</Link><p>{campaign.recipientCount ? messages.ui.snapshottedRecipients.replace("{count}", number.format(campaign.recipientCount)) : messages.ui.preparingSnapshot}</p></div><div className="numberMeta"><span>{dateTime.format(campaign.createdAt)}</span><span className={campaign.status === "completed" ? "status connected" : "status"}>{campaign.status}</span><Link href={`/campaigns/${campaign.id}`}>{messages.ui.viewAnalytics} →</Link></div></div>)}</div> : <div className="emptyState" style={{ marginTop: 14 }}><div className="emptyIcon">C</div><h3>{messages.ui.noCampaigns}</h3><p>{messages.ui.noCampaignsDescription}</p></div>}
      </section>
    </section>
  </main>;
}
