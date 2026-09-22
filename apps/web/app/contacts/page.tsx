import Link from "next/link";
import { count, desc, eq, sql } from "drizzle-orm";
import { schema } from "@wa/db";
import { AppSidebar } from "@/components/app-sidebar";
import { ContactManager } from "@/components/contact-manager";
import { requireAuthContext } from "@/lib/auth-context";
import { countEligibleAudience } from "@/lib/audience-server";
import { getI18n } from "@/lib/i18n/server";
import { db } from "@/lib/server";
import { can } from "@/lib/workspace-access";

export const dynamic = "force-dynamic";
type PageProps = { searchParams: Promise<{ q?: string; status?: string }> };

export default async function ContactsPage({ searchParams }: PageProps) {
  const { session, workspace } = await requireAuthContext();
  const { messages, localeTag } = await getI18n();
  const number = new Intl.NumberFormat(localeTag);
  const organizationId = workspace.organizationId;
  const params = await searchParams;
  const initialQuery = (params.q ?? "").trim().slice(0, 80);
  const initialStatus = ["all", "eligible", "suppressed", "not_eligible"].includes(params.status ?? "") ? params.status! : "all";

  const [activeCountRows, suppressionRows, eventCountRows, events, eligible] = await Promise.all([
    db.execute(sql`
      SELECT count(*)::int AS total
      FROM contacts c
      WHERE c.organization_id = ${organizationId}::uuid
        AND NOT EXISTS (
          SELECT 1 FROM contact_merges cm
          WHERE cm.organization_id = ${organizationId}::uuid AND cm.source_contact_id = c.id
        )
    `),
    db.select({ total: count() }).from(schema.suppressionList).where(eq(schema.suppressionList.organizationId, organizationId)),
    db.select({ total: count() }).from(schema.contactConsentEvents).where(eq(schema.contactConsentEvents.organizationId, organizationId)),
    db.select({ id: schema.contactConsentEvents.id, phoneE164: schema.contactConsentEvents.phoneE164, eventType: schema.contactConsentEvents.eventType, source: schema.contactConsentEvents.source, note: schema.contactConsentEvents.note, occurredAt: schema.contactConsentEvents.occurredAt })
      .from(schema.contactConsentEvents)
      .where(eq(schema.contactConsentEvents.organizationId, organizationId))
      .orderBy(desc(schema.contactConsentEvents.occurredAt))
      .limit(25),
    countEligibleAudience(organizationId, { type: "all" }),
  ]);

  const initials = workspace.organizationName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const total = Number((activeCountRows[0] as { total?: number } | undefined)?.total ?? 0);
  const suppressions = suppressionRows[0]?.total ?? 0;
  const eventCount = eventCountRows[0]?.total ?? 0;

  return <main className="shell">
    <AppSidebar active="contacts" workspaceName={workspace.organizationName} email={session.user.email} initials={initials} />
    <section className="content">
      <header className="topbar"><div><p className="eyebrow">{messages.nav.contacts}</p><h1>{messages.ui.contactsTitle}</h1><p className="subtitle">{messages.ui.contactsSubtitle}</p></div><Link className="secondary" href="/dashboard#contacts">{messages.ui.importContactsButton}</Link></header>
      <section className="statsGrid" aria-label={messages.ui.contactConsentStats}>
        <article className="statCard"><span>{messages.ui.totalContacts}</span><strong>{number.format(total)}</strong><p>{messages.ui.contactsStored}</p></article>
        <article className="statCard"><span>{messages.ui.eligibleNow}</span><strong>{number.format(eligible)}</strong><p>{messages.ui.optedInNotSuppressed}</p></article>
        <article className="statCard"><span>{messages.ui.activeSuppressions}</span><strong>{number.format(suppressions)}</strong><p>{messages.ui.authoritativeBlockList}</p></article>
        <article className="statCard"><span>{messages.ui.consentEvents}</span><strong>{number.format(eventCount)}</strong><p>{messages.ui.consentHistoryDetail}</p></article>
      </section>

      <ContactManager
        canManage={can(workspace.role, "contacts.manage")}
        canResubscribe={can(workspace.role, "contacts.restoreConsent")}
        initialQuery={initialQuery}
        initialStatus={initialStatus}
      />

      <section className="panel" style={{ display: "grid", gap: 12 }}>
        <div><strong>{messages.ui.consentHistory}</strong><p className="subtitle">{messages.ui.historyAppendOnly}</p></div>
        {events.length ? events.map((event) => <div className="numberRow" key={event.id}><div><strong>{event.eventType.replaceAll("_", " ")}</strong><p>{event.phoneE164} · {event.source}</p>{event.note ? <p className="subtitle">{event.note}</p> : null}</div><span className="subtitle">{event.occurredAt.toLocaleString(localeTag)}</span></div>) : <p className="subtitle">{messages.ui.noConsentEvents}</p>}
      </section>
    </section>
  </main>;
}
