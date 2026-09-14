import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { schema } from "@wa/db";
import { AppSidebar } from "@/components/app-sidebar";
import { ContactSuppressionManager } from "@/components/contact-suppression-manager";
import { requireAuthContext } from "@/lib/auth-context";
import { getI18n } from "@/lib/i18n/server";
import { db } from "@/lib/server";

export const dynamic = "force-dynamic";
type PageProps = { params: Promise<{ id: string }> };

export default async function ContactResubscribePage({ params }: PageProps) {
  const { id } = await params;
  const { session, workspace } = await requireAuthContext();
  const { messages } = await getI18n();

  if (workspace.role !== "owner" && workspace.role !== "admin") notFound();

  const [contact] = await db
    .select({
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
    .leftJoin(
      schema.suppressionList,
      and(
        eq(schema.suppressionList.organizationId, schema.contacts.organizationId),
        eq(schema.suppressionList.phoneE164, schema.contacts.phoneE164),
      ),
    )
    .where(and(eq(schema.contacts.id, id), eq(schema.contacts.organizationId, workspace.organizationId)))
    .limit(1);

  if (!contact) notFound();

  const events = await db
    .select({
      id: schema.contactConsentEvents.id,
      phoneE164: schema.contactConsentEvents.phoneE164,
      eventType: schema.contactConsentEvents.eventType,
      source: schema.contactConsentEvents.source,
      note: schema.contactConsentEvents.note,
      occurredAt: schema.contactConsentEvents.occurredAt,
    })
    .from(schema.contactConsentEvents)
    .where(and(
      eq(schema.contactConsentEvents.organizationId, workspace.organizationId),
      eq(schema.contactConsentEvents.phoneE164, contact.phoneE164),
    ))
    .orderBy(desc(schema.contactConsentEvents.occurredAt))
    .limit(25);

  const initials = workspace.organizationName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

  return <main className="shell">
    <AppSidebar active="contacts" workspaceName={workspace.organizationName} email={session.user.email} initials={initials} />
    <section className="content">
      <header className="topbar">
        <div>
          <p className="eyebrow">{messages.nav.contacts}</p>
          <h1>{messages.ui.recordNewConsent}</h1>
          <p className="subtitle">{messages.ui.resubscribeDescription}</p>
        </div>
        <Link className="secondary" href="/contacts">{messages.nav.contacts}</Link>
      </header>
      <ContactSuppressionManager
        initialAction={{ mode: "resubscribe", contactId: contact.id }}
        canSuppress={false}
        canResubscribe
        contacts={[{
          ...contact,
          optInAt: contact.optInAt?.toISOString() ?? null,
          unsubscribedAt: contact.unsubscribedAt?.toISOString() ?? null,
          suppressedAt: contact.suppressedAt?.toISOString() ?? null,
        }]}
        events={events.map((event) => ({ ...event, occurredAt: event.occurredAt.toISOString() }))}
      />
    </section>
  </main>;
}
