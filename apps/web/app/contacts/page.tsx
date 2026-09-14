import Link from "next/link";
import { and, count, desc, eq, ilike, isNotNull, isNull, or, type SQL } from "drizzle-orm";
import { schema } from "@wa/db";
import { AppSidebar } from "@/components/app-sidebar";
import { ContactSuppressionManager } from "@/components/contact-suppression-manager";
import { requireAuthContext } from "@/lib/auth-context";
import { countEligibleAudience } from "@/lib/audience-server";
import { getI18n } from "@/lib/i18n/server";
import { db } from "@/lib/server";

export const dynamic = "force-dynamic";
type PageProps = { searchParams: Promise<{ q?: string; status?: string; contactAction?: string; contactId?: string }> };

export default async function ContactsPage({ searchParams }: PageProps) {
  const { session, workspace } = await requireAuthContext();
  const { messages, localeTag } = await getI18n();
  const number = new Intl.NumberFormat(localeTag);
  const params = await searchParams;
  const organizationId = workspace.organizationId;
  const query = (params.q ?? "").trim().slice(0, 80);
  const status = ["all", "eligible", "suppressed", "not_eligible"].includes(params.status ?? "") ? params.status! : "all";
  const contactId = (params.contactId ?? "").trim().slice(0, 80);
  const initialAction = params.contactAction === "resubscribe" && contactId ? { mode: "resubscribe" as const, contactId } : null;

  let where: SQL = eq(schema.contacts.organizationId, organizationId);
  if (query) where = and(where, or(ilike(schema.contacts.phoneE164, `%${query}%`), ilike(schema.contacts.displayName, `%${query}%`)))!;
  if (status === "eligible") where = and(where, eq(schema.contacts.optedIn, true), isNull(schema.contacts.unsubscribedAt), isNull(schema.suppressionList.id))!;
  else if (status === "suppressed") where = and(where, isNotNull(schema.suppressionList.id))!;
  else if (status === "not_eligible") where = and(where, or(eq(schema.contacts.optedIn, false), isNotNull(schema.contacts.unsubscribedAt), isNotNull(schema.suppressionList.id)))!;

  const [contactRows, totalRows, suppressionRows, eventCountRows, events, eligible] = await Promise.all([
    db.select({ id: schema.contacts.id, phoneE164: schema.contacts.phoneE164, displayName: schema.contacts.displayName, optedIn: schema.contacts.optedIn, optInSource: schema.contacts.optInSource, optInAt: schema.contacts.optInAt, unsubscribedAt: schema.contacts.unsubscribedAt, suppressedAt: schema.suppressionList.suppressedAt, suppressionReason: schema.suppressionList.reason, suppressionSource: schema.suppressionList.source })
      .from(schema.contacts).leftJoin(schema.suppressionList, and(eq(schema.suppressionList.organizationId, schema.contacts.organizationId), eq(schema.suppressionList.phoneE164, schema.contacts.phoneE164))).where(where).orderBy(desc(schema.contacts.createdAt)).limit(100),
    db.select({ total: count() }).from(schema.contacts).where(eq(schema.contacts.organizationId, organizationId)),
    db.select({ total: count() }).from(schema.suppressionList).where(eq(schema.suppressionList.organizationId, organizationId)),
    db.select({ total: count() }).from(schema.contactConsentEvents).where(eq(schema.contactConsentEvents.organizationId, organizationId)),
    db.select({ id: schema.contactConsentEvents.id, phoneE164: schema.contactConsentEvents.phoneE164, eventType: schema.contactConsentEvents.eventType, source: schema.contactConsentEvents.source, note: schema.contactConsentEvents.note, occurredAt: schema.contactConsentEvents.occurredAt }).from(schema.contactConsentEvents).where(eq(schema.contactConsentEvents.organizationId, organizationId)).orderBy(desc(schema.contactConsentEvents.occurredAt)).limit(25),
    countEligibleAudience(organizationId, { type: "all" }),
  ]);

  const initials = workspace.organizationName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const total = totalRows[0]?.total ?? 0;
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
      <section className="panel contactFilterPanel">
        <form className="contactFilters" method="get">
          <label><span>{messages.ui.search}</span><input defaultValue={query} name="q" placeholder={messages.ui.searchPlaceholder} /></label>
          <label><span>{messages.ui.status}</span><select defaultValue={status} name="status"><option value="all">{messages.ui.allContacts}</option><option value="eligible">{messages.ui.eligible}</option><option value="suppressed">{messages.ui.suppressed}</option><option value="not_eligible">{messages.ui.needsConsent}</option></select></label>
          <button className="primary" type="submit">{messages.ui.applyFilters}</button>{(query || status !== "all") ? <Link className="secondary" href="/contacts">{messages.ui.clear}</Link> : null}
        </form><p className="subtitle">{messages.ui.showingContacts}</p>
      </section>
      <ContactSuppressionManager
        initialAction={initialAction}
        filterQuery={query}
        filterStatus={status}
        canSuppress={workspace.role !== "viewer"}
        canResubscribe={workspace.role === "owner" || workspace.role === "admin"}
        contacts={contactRows.map((contact) => ({ ...contact, optInAt: contact.optInAt?.toISOString() ?? null, unsubscribedAt: contact.unsubscribedAt?.toISOString() ?? null, suppressedAt: contact.suppressedAt?.toISOString() ?? null }))}
        events={events.map((event) => ({ ...event, occurredAt: event.occurredAt.toISOString() }))}
      />
    </section>
  </main>;
}
