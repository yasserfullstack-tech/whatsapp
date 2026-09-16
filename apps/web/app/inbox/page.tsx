import Link from "next/link";
import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { schema } from "@wa/db";
import { AppSidebar } from "@/components/app-sidebar";
import { InboxActions } from "@/components/inbox-actions";
import { requireAuthContext } from "@/lib/auth-context";
import { canSendAgentReply, inboxMessagePreview } from "@/lib/inbox";
import { getI18n } from "@/lib/i18n/server";
import { db } from "@/lib/server";
import { can } from "@/lib/workspace-access";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function scalar(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

function conversationHref(input: {
  id: string;
  q: string;
  status: string;
  assigned: string;
}): string {
  const params = new URLSearchParams();
  params.set("conversation", input.id);
  if (input.q) params.set("q", input.q);
  if (input.status && input.status !== "all") params.set("status", input.status);
  if (input.assigned) params.set("assigned", input.assigned);
  return `/inbox?${params.toString()}`;
}

export default async function InboxPage({ searchParams }: Props) {
  const { session, workspace } = await requireAuthContext();
  const { locale, localeTag } = await getI18n();
  const ar = locale === "ar";
  const params = await searchParams;
  const q = scalar(params.q).trim().slice(0, 200);
  const status = ["open", "closed", "all"].includes(scalar(params.status)) ? scalar(params.status) : "open";
  const assigned = scalar(params.assigned);
  const selectedId = scalar(params.conversation);
  const organizationId = workspace.organizationId;
  const canRead = can(workspace.role, "inbox.read");
  const canManage = can(workspace.role, "inbox.manage");
  const initials = workspace.organizationName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

  if (!canRead) {
    return (
      <main className="shell">
        <AppSidebar active="inbox" workspaceName={workspace.organizationName} email={session.user.email} initials={initials} />
        <section className="content"><div className="panel"><h1>{ar ? "صندوق الوارد" : "Inbox"}</h1><p>{ar ? "ليست لديك صلاحية لعرض صندوق الوارد." : "You do not have permission to view the inbox."}</p></div></section>
      </main>
    );
  }

  const filters: SQL[] = [eq(schema.inboxConversations.organizationId, organizationId)];
  if (status === "open" || status === "closed") filters.push(eq(schema.inboxConversations.status, status));
  if (assigned === "me") filters.push(eq(schema.inboxConversations.assignedUserId, workspace.userId));
  if (assigned === "unassigned") filters.push(isNull(schema.inboxConversations.assignedUserId));
  if (q) {
    const pattern = `%${q}%`;
    const search = or(
      ilike(schema.inboxConversations.customerDisplayName, pattern),
      ilike(schema.inboxConversations.customerPhoneE164, pattern),
      sql`exists (
        select 1 from inbox_messages im
        where im.conversation_id = ${schema.inboxConversations.id}
          and im.organization_id = ${organizationId}::uuid
          and (im.text ilike ${pattern} or im.media_caption ilike ${pattern})
      )`,
    );
    if (search) filters.push(search);
  }

  const conversations = await db
    .select({
      id: schema.inboxConversations.id,
      customerPhoneE164: schema.inboxConversations.customerPhoneE164,
      customerDisplayName: schema.inboxConversations.customerDisplayName,
      assignedUserId: schema.inboxConversations.assignedUserId,
      assignedName: schema.users.displayName,
      status: schema.inboxConversations.status,
      unreadCount: schema.inboxConversations.unreadCount,
      lastMessageAt: schema.inboxConversations.lastMessageAt,
      lastInboundAt: schema.inboxConversations.lastInboundAt,
      businessName: schema.whatsappPhoneNumbers.verifiedName,
      businessPhone: schema.whatsappPhoneNumbers.displayPhoneNumber,
    })
    .from(schema.inboxConversations)
    .innerJoin(schema.whatsappPhoneNumbers, eq(schema.whatsappPhoneNumbers.id, schema.inboxConversations.whatsappPhoneNumberId))
    .leftJoin(schema.users, eq(schema.users.id, schema.inboxConversations.assignedUserId))
    .where(and(...filters))
    .orderBy(desc(schema.inboxConversations.lastMessageAt))
    .limit(200);

  const selected = conversations.find((conversation) => conversation.id === selectedId) ?? conversations[0] ?? null;
  const [messages, notes, members] = selected ? await Promise.all([
    db
      .select({
        id: schema.inboxMessages.id,
        direction: schema.inboxMessages.direction,
        source: schema.inboxMessages.source,
        messageType: schema.inboxMessages.messageType,
        status: schema.inboxMessages.status,
        wamid: schema.inboxMessages.wamid,
        text: schema.inboxMessages.text,
        mediaId: schema.inboxMessages.mediaId,
        mediaMimeType: schema.inboxMessages.mediaMimeType,
        mediaFileName: schema.inboxMessages.mediaFileName,
        mediaCaption: schema.inboxMessages.mediaCaption,
        errorMessage: schema.inboxMessages.errorMessage,
        providerTimestamp: schema.inboxMessages.providerTimestamp,
        createdAt: schema.inboxMessages.createdAt,
        agentName: schema.users.displayName,
      })
      .from(schema.inboxMessages)
      .leftJoin(schema.users, eq(schema.users.id, schema.inboxMessages.agentUserId))
      .where(and(
        eq(schema.inboxMessages.organizationId, organizationId),
        eq(schema.inboxMessages.conversationId, selected.id),
      ))
      .orderBy(asc(schema.inboxMessages.createdAt))
      .limit(1_000),
    db
      .select({
        id: schema.inboxNotes.id,
        body: schema.inboxNotes.body,
        createdAt: schema.inboxNotes.createdAt,
        authorName: schema.users.displayName,
      })
      .from(schema.inboxNotes)
      .innerJoin(schema.users, eq(schema.users.id, schema.inboxNotes.authorUserId))
      .where(and(
        eq(schema.inboxNotes.organizationId, organizationId),
        eq(schema.inboxNotes.conversationId, selected.id),
      ))
      .orderBy(asc(schema.inboxNotes.createdAt))
      .limit(500),
    db
      .select({ id: schema.users.id, name: schema.users.displayName, email: schema.users.email })
      .from(schema.organizationMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.organizationMembers.userId))
      .where(eq(schema.organizationMembers.organizationId, organizationId))
      .orderBy(asc(schema.users.displayName), asc(schema.users.email)),
  ]) : [[], [], []];

  const dateTime = new Intl.DateTimeFormat(localeTag, { dateStyle: "medium", timeStyle: "short" });

  return (
    <main className="shell">
      <AppSidebar active="inbox" workspaceName={workspace.organizationName} email={session.user.email} initials={initials} />
      <section className="content">
        <header className="topbar">
          <div><p className="eyebrow">{ar ? "واتساب" : "WhatsApp"}</p><h1>{ar ? "صندوق الوارد" : "Inbox"}</h1><p className="subtitle">{ar ? "محادثات العملاء الواردة وردود الفريق الداخلية." : "Customer conversations, agent replies, assignments, and internal notes."}</p></div>
        </header>

        <section className="panel" style={{ marginBottom: 18 }}>
          <form method="get" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
            <label style={{ display: "grid", gap: 5, minWidth: 240, flex: 1 }}><span className="eyebrow">{ar ? "بحث" : "Search"}</span><input name="q" defaultValue={q} placeholder={ar ? "الاسم أو الرقم أو نص الرسالة" : "Name, phone, or message text"} /></label>
            <label style={{ display: "grid", gap: 5 }}><span className="eyebrow">{ar ? "الحالة" : "Status"}</span><select name="status" defaultValue={status}><option value="open">{ar ? "مفتوحة" : "Open"}</option><option value="closed">{ar ? "مغلقة" : "Closed"}</option><option value="all">{ar ? "الكل" : "All"}</option></select></label>
            <label style={{ display: "grid", gap: 5 }}><span className="eyebrow">{ar ? "التعيين" : "Assignment"}</span><select name="assigned" defaultValue={assigned}><option value="">{ar ? "الكل" : "All"}</option><option value="me">{ar ? "مُعيّنة لي" : "Assigned to me"}</option><option value="unassigned">{ar ? "غير معيّنة" : "Unassigned"}</option></select></label>
            <button className="secondary" type="submit">{ar ? "تصفية" : "Filter"}</button>
          </form>
        </section>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 0.8fr) minmax(0, 2fr)", gap: 18, alignItems: "start" }}>
          <aside className="panel" style={{ padding: 0, overflow: "hidden" }}>
            <div className="panelHeader" style={{ padding: 18 }}><div><h2>{ar ? "المحادثات" : "Conversations"}</h2><p className="subtitle">{conversations.length} {ar ? "محادثة" : "shown"}</p></div></div>
            <div style={{ display: "grid", maxHeight: "70vh", overflow: "auto" }}>
              {conversations.map((conversation) => {
                const active = selected?.id === conversation.id;
                return (
                  <Link
                    key={conversation.id}
                    href={conversationHref({ id: conversation.id, q, status, assigned })}
                    style={{ padding: 16, borderTop: "1px solid var(--border, #e5e7eb)", textDecoration: "none", background: active ? "rgba(37, 99, 235, 0.06)" : undefined, color: "inherit" }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><strong>{conversation.customerDisplayName ?? conversation.customerPhoneE164}</strong>{conversation.unreadCount > 0 ? <span className="status connected">{conversation.unreadCount}</span> : null}</div>
                    <p style={{ margin: "6px 0 0" }}>{conversation.customerPhoneE164}</p>
                    <p className="subtitle" style={{ margin: "6px 0 0" }}>{dateTime.format(conversation.lastMessageAt)} · {conversation.status}{conversation.assignedName ? ` · ${conversation.assignedName}` : ""}</p>
                  </Link>
                );
              })}
              {!conversations.length ? <div className="emptyState" style={{ margin: 18 }}><h3>{ar ? "لا توجد محادثات" : "No conversations"}</h3><p>{ar ? "ستظهر رسائل العملاء الواردة هنا." : "Inbound customer messages will appear here."}</p></div> : null}
            </div>
          </aside>

          <section style={{ display: "grid", gap: 18 }}>
            {selected ? <>
              <article className="panel">
                <div className="panelHeader">
                  <div><p className="eyebrow">{selected.businessName ?? selected.businessPhone ?? (ar ? "رقم واتساب" : "WhatsApp number")}</p><h2>{selected.customerDisplayName ?? selected.customerPhoneE164}</h2><p className="subtitle">{selected.customerPhoneE164} · {selected.status} · {selected.assignedName ?? (ar ? "غير معيّن" : "Unassigned")}</p></div>
                </div>
                <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
                  {messages.map((message) => (
                    <div key={message.id} style={{ justifySelf: message.direction === "outbound" ? "end" : "start", maxWidth: "82%", padding: 12, borderRadius: 12, background: message.direction === "outbound" ? "rgba(37, 99, 235, 0.08)" : "rgba(15, 23, 42, 0.05)", border: "1px solid var(--border, #e5e7eb)" }}>
                      <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "baseline" }}><strong>{message.direction === "outbound" ? (message.agentName ?? (ar ? "الفريق" : "Team")) : (selected.customerDisplayName ?? selected.customerPhoneE164)}</strong><span className="subtitle">{message.source}</span></div>
                      <p style={{ whiteSpace: "pre-wrap", margin: "8px 0" }}>{inboxMessagePreview(message)}</p>
                      {message.mediaId ? <p className="subtitle" style={{ margin: "4px 0" }}>{message.messageType} · {message.mediaFileName ?? message.mediaMimeType ?? message.mediaId}</p> : null}
                      {message.errorMessage ? <p style={{ margin: "4px 0" }}>{message.errorMessage}</p> : null}
                      <p className="subtitle" style={{ margin: 0 }}>{dateTime.format(message.providerTimestamp ?? message.createdAt)} · {message.status}{message.wamid ? ` · ${message.wamid.slice(0, 24)}` : ""}</p>
                    </div>
                  ))}
                  {!messages.length ? <p className="subtitle">{ar ? "لا توجد رسائل بعد." : "No messages yet."}</p> : null}
                </div>
              </article>

              <article className="panel">
                <InboxActions
                  conversationId={selected.id}
                  status={selected.status}
                  assignedUserId={selected.assignedUserId}
                  members={members.map((member) => ({ id: member.id, name: member.name || member.email }))}
                  canManage={canManage}
                  replyWindowOpen={canSendAgentReply(selected.lastInboundAt)}
                  locale={ar ? "ar" : "en"}
                />
              </article>

              <article className="panel">
                <div className="panelHeader"><div><p className="eyebrow">{ar ? "داخلي" : "Internal"}</p><h2>{ar ? "الملاحظات" : "Notes"}</h2></div></div>
                <div style={{ display: "grid", gap: 10, marginTop: 14 }}>{notes.map((note) => <div key={note.id} style={{ borderTop: "1px solid var(--border, #e5e7eb)", paddingTop: 10 }}><strong>{note.authorName ?? (ar ? "عضو الفريق" : "Team member")}</strong><p style={{ whiteSpace: "pre-wrap" }}>{note.body}</p><p className="subtitle">{dateTime.format(note.createdAt)}</p></div>)}{!notes.length ? <p className="subtitle">{ar ? "لا توجد ملاحظات داخلية." : "No internal notes."}</p> : null}</div>
              </article>
            </> : <article className="panel"><div className="emptyState"><h2>{ar ? "صندوق الوارد جاهز" : "Inbox is ready"}</h2><p>{ar ? "ستظهر أول محادثة عند وصول رسالة واتساب." : "The first thread will appear when a WhatsApp message arrives."}</p></div></article>}
          </section>
        </div>
      </section>
    </main>
  );
}
