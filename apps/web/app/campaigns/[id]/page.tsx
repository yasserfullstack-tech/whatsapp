import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { schema } from "@wa/db";
import { AppSidebar } from "@/components/app-sidebar";
import { CampaignAnalytics } from "@/components/campaign-analytics";
import { CampaignControls } from "@/components/campaign-controls";
import { requireAuthContext } from "@/lib/auth-context";
import { getI18n } from "@/lib/i18n/server";
import { db } from "@/lib/server";

export const dynamic = "force-dynamic";
type PageProps = { params: Promise<{ id: string }> };

export default async function CampaignAnalyticsPage({ params }: PageProps) {
  const { id } = await params;
  const { session, workspace } = await requireAuthContext();
  const { messages, localeTag } = await getI18n();
  const number = new Intl.NumberFormat(localeTag);
  const [[campaign], preferences] = await Promise.all([
    db.select({ id: schema.campaigns.id, name: schema.campaigns.name, status: schema.campaigns.status, scheduledAt: schema.campaigns.scheduledAt, recipientCount: schema.campaigns.recipientCount, phoneName: schema.whatsappPhoneNumbers.verifiedName, displayPhoneNumber: schema.whatsappPhoneNumbers.displayPhoneNumber, templateName: schema.templates.name, templateLanguage: schema.templates.language }).from(schema.campaigns).innerJoin(schema.whatsappPhoneNumbers, eq(schema.campaigns.whatsappPhoneNumberId, schema.whatsappPhoneNumbers.id)).innerJoin(schema.templates, eq(schema.campaigns.templateId, schema.templates.id)).where(and(eq(schema.campaigns.id, id), eq(schema.campaigns.organizationId, workspace.organizationId))).limit(1),
    db.select({ timezone: schema.workspacePreferences.timezone }).from(schema.workspacePreferences).where(eq(schema.workspacePreferences.organizationId, workspace.organizationId)).limit(1),
  ]);
  if (!campaign) notFound();
  const timeZone = preferences[0]?.timezone ?? "UTC";
  const initials = workspace.organizationName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  return <main className="shell">
    <AppSidebar active="campaigns" workspaceName={workspace.organizationName} email={session.user.email} initials={initials} />
    <section className="content">
      <header className="topbar"><div><p className="eyebrow">{messages.ui.campaignAnalytics}</p><h1>{campaign.name}</h1><p className="subtitle">{campaign.phoneName ?? messages.common.whatsappBusiness} · {campaign.displayPhoneNumber ?? messages.ui.connectedNumber} · {campaign.templateName} ({campaign.templateLanguage}) · {number.format(campaign.recipientCount)} {messages.ui.recipients}</p></div><Link className="secondary" href="/campaigns">{messages.ui.backToCampaigns}</Link></header>
      <CampaignControls campaignId={campaign.id} initialStatus={campaign.status} initialScheduledAt={campaign.scheduledAt?.toISOString() ?? null} timeZone={timeZone} />
      <CampaignAnalytics campaignId={campaign.id} />
    </section>
  </main>;
}
