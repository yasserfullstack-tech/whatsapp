import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { schema } from "@wa/db";
import { AppSidebar } from "@/components/app-sidebar";
import { ContactResubscribeForm } from "@/components/contact-resubscribe-form";
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
    })
    .from(schema.contacts)
    .where(and(eq(schema.contacts.id, id), eq(schema.contacts.organizationId, workspace.organizationId)))
    .limit(1);

  if (!contact) notFound();

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
      <ContactResubscribeForm contactId={contact.id} phoneE164={contact.phoneE164} displayName={contact.displayName} />
    </section>
  </main>;
}
