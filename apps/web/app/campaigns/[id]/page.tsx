import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { schema } from "@wa/db";
import { CampaignAnalytics } from "@/components/campaign-analytics";
import { CampaignControls } from "@/components/campaign-controls";
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

type PageProps = { params: Promise<{ id: string }> };

export default async function CampaignAnalyticsPage({ params }: PageProps) {
  const { id } = await params;
  const { session, workspace } = await requireAuthContext();
  const [campaign] = await db
    .select({
      id: schema.campaigns.id,
      name: schema.campaigns.name,
      status: schema.campaigns.status,
      recipientCount: schema.campaigns.recipientCount,
      createdAt: schema.campaigns.createdAt,
      phoneName: schema.whatsappPhoneNumbers.verifiedName,
      displayPhoneNumber: schema.whatsappPhoneNumbers.displayPhoneNumber,
      templateName: schema.templates.name,
      templateLanguage: schema.templates.language,
    })
    .from(schema.campaigns)
    .innerJoin(schema.whatsappPhoneNumbers, eq(schema.campaigns.whatsappPhoneNumberId, schema.whatsappPhoneNumbers.id))
    .innerJoin(schema.templates, eq(schema.campaigns.templateId, schema.templates.id))
    .where(and(
      eq(schema.campaigns.id, id),
      eq(schema.campaigns.organizationId, workspace.organizationId),
    ))
    .limit(1);

  if (!campaign) notFound();

  const initials = workspace.organizationName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

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
          <div>
            <p className="eyebrow">Campaign analytics</p>
            <h1>{campaign.name}</h1>
            <p className="subtitle">
              {campaign.phoneName ?? "WhatsApp Business"} · {campaign.displayPhoneNumber ?? "connected number"} · {campaign.templateName} ({campaign.templateLanguage}) · {campaign.recipientCount.toLocaleString()} recipients
            </p>
          </div>
          <Link className="secondary" href="/campaigns">Back to campaigns</Link>
        </header>

        <CampaignControls campaignId={campaign.id} initialStatus={campaign.status} />
        <CampaignAnalytics campaignId={campaign.id} />
      </section>
    </main>
  );
}
