import Link from "next/link";
import { and, count, desc, eq, ilike, isNotNull, isNull, or, type SQL } from "drizzle-orm";
import { schema } from "@wa/db";
import { ContactSuppressionManager } from "@/components/contact-suppression-manager";
import { SignOutButton } from "@/components/sign-out-button";
import { requireAuthContext } from "@/lib/auth-context";
import { countEligibleAudience } from "@/lib/audience-server";
import { db } from "@/lib/server";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ q?: string; status?: string }> };

const nav = [
  { label: "Overview", href: "/dashboard" },
  { label: "Contacts", href: "/contacts" },
  { label: "Audiences", href: "/audiences" },
  { label: "Templates", href: "/templates" },
  { label: "Campaigns", href: "/campaigns" },
  { label: "Reports", href: "/campaigns" },
  { label: "Settings", href: "/dashboard" },
];

export default async function ContactsPage({ searchParams }: PageProps) {
  const { session, workspace } = await requireAuthContext();
  const params = await searchParams;
  const organizationId = workspace.organizationId;
  const query = (params.q ?? "").trim().slice(0, 80);
  const status = ["all", "eligible", "suppressed", "not_eligible"].includes(params.status ?? "") ? params.status! : "all";

  let where: SQL = eq(schema.contacts.organizationId, organizationId);
  if (query) {
    where = and(where, or(ilike(schema.contacts.phoneE164, `%${query}%`), ilike(schema.contacts.displayName, `%${query}%`)))!;
  }
  if (status === "eligible") {
    where = and(where, eq(schema.contacts.optedIn, true), isNull(schema.contacts.unsubscribedAt), isNull(schema.suppressionList.id))!;
  } else if (status === "suppressed") {
    where = and(where, isNotNull(schema.suppressionList.id))!;
  } else if (status === "not_eligible") {
    where = and(where, or(eq(schema.contacts.optedIn, false), isNotNull(schema.contacts.unsubscribedAt), isNotNull(schema.suppressionList.id)))!;
  }

  const [contactRows, totalRows, suppressionRows, eventCountRows, events, eligible] = await Promise.all([
    db.select({
      id: schema.contacts.id,
      phoneE164: schema.contacts.phoneE164,
      displayName: schema.contacts.displayName,
      optedIn: schema.contacts.optedIn,
      optInSource: schema.contacts.optInSource,
      optInAt: schema.contacts.optInAt,
      unsubscribedAt: schema.contacts.unsubscribedAt,
      suppressedAt: schema.suppressionList.suppressedAt,
      suppressionReason: schema.suppressionList.reason,
      suppressionSource: schema.suppressionList.source,
    })
      .from(schema.contacts)
      .leftJoin(schema.suppressionList, and(
        eq(schema.suppressionList.organizationId, schema.contacts.organizationId),
        eq(schema.suppressionList.phoneE164, schema.contacts.phoneE164),
      ))
      .where(where)
      .orderBy(desc(schema.contacts.createdAt))
      .limit(100),
    db.select({ total: count() }).from(schema.contacts).where(eq(schema.contacts.organizationId, organizationId)),
    db.select({ total: count() }).from(schema.suppressionList).where(eq(schema.suppressionList.organizationId, organizationId)),
    db.select({ total: count() }).from(schema.contactConsentEvents).where(eq(schema.contactConsentEvents.organizationId, organizationId)),
    db.select({
      id: schema.contactConsentEvents.id,
      phoneE164: schema.contactConsentEvents.phoneE164,
      eventType: schema.contactConsentEvents.eventType,
      source: schema.contactConsentEvents.source,
      note: schema.contactConsentEvents.note,
      occurredAt: schema.contactConsentEvents.occurredAt,
    })
      .from(schema.contactConsentEvents)
      .where(eq(schema.contactConsentEvents.organizationId, organizationId))
      .orderBy(desc(schema.contactConsentEvents.occurredAt))
      .limit(25),
    countEligibleAudience(organizationId, { type: "all" }),
  ]);

  const initials = workspace.organizationName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const total = totalRows[0]?.total ?? 0;
  const suppressions = suppressionRows[0]?.total ?? 0;
  const eventCount = eventCountRows[0]?.total ?? 0;

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><div className="brandMark">W</div><div><strong>WhatsApp</strong><span>Campaigns</span></div></div>
        <nav className="nav" aria-label="Primary navigation">{nav.map((item) => <Link className={item.label === "Contacts" ? "navItem active" : "navItem"} href={item.href} key={item.label}><span className="navDot" aria-hidden="true" />{item.label}</Link>)}</nav>
        <div className="workspace"><div className="workspaceAvatar">{initials || "W"}</div><div className="workspaceMeta"><strong>{workspace.organizationName}</strong><span>{session.user.email}</span></div><SignOutButton /></div>
      </aside>

      <section className="content">
        <header className="topbar"><div><p className="eyebrow">Contacts</p><h1>Consent and suppression</h1><p className="subtitle">Manage current marketing eligibility without erasing opt-out history. Restoring eligibility requires explicit evidence of new consent.</p></div><Link className="secondary" href="/dashboard#contacts">Import contacts</Link></header>

        <section className="statsGrid" aria-label="Contact consent statistics">
          <article className="statCard"><span>Total contacts</span><strong>{total.toLocaleString()}</strong><p>Contacts stored in this workspace</p></article>
          <article className="statCard"><span>Eligible now</span><strong>{eligible.toLocaleString()}</strong><p>Opted in and not suppressed</p></article>
          <article className="statCard"><span>Active suppressions</span><strong>{suppressions.toLocaleString()}</strong><p>Authoritative block list entries</p></article>
          <article className="statCard"><span>Consent events</span><strong>{eventCount.toLocaleString()}</strong><p>Append-only opt-out and re-consent history</p></article>
        </section>

        <section className="panel contactFilterPanel">
          <form className="contactFilters" method="get">
            <label><span>Search</span><input defaultValue={query} name="q" placeholder="Name or +964…" /></label>
            <label><span>Status</span><select defaultValue={status} name="status"><option value="all">All contacts</option><option value="eligible">Eligible</option><option value="suppressed">Suppressed</option><option value="not_eligible">Needs consent / opted out</option></select></label>
            <button className="primary" type="submit">Apply filters</button>
            {(query || status !== "all") ? <Link className="secondary" href="/contacts">Clear</Link> : null}
          </form>
          <p className="subtitle">Showing up to 100 matching contacts. Search narrows by display name or E.164 phone number.</p>
        </section>

        <ContactSuppressionManager
          canSuppress={workspace.role !== "viewer"}
          canResubscribe={workspace.role === "owner" || workspace.role === "admin"}
          contacts={contactRows.map((contact) => ({ ...contact, optInAt: contact.optInAt?.toISOString() ?? null, unsubscribedAt: contact.unsubscribedAt?.toISOString() ?? null, suppressedAt: contact.suppressedAt?.toISOString() ?? null }))}
          events={events.map((event) => ({ ...event, occurredAt: event.occurredAt.toISOString() }))}
        />
      </section>
    </main>
  );
}
