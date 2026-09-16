"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type Member = { id: string; name: string };
type AsyncInboxOperation = () =>
  Promise<void>;

type Props = {
  conversationId: string;
  status: "open" | "closed";
  assignedUserId: string | null;
  members: Member[];
  canManage: boolean;
  replyWindowOpen: boolean;
  locale: "en" | "ar";
};

export function InboxActions(props: Props) {
  const router = useRouter();
  const [assignee, setAssignee] = useState(props.assignedUserId ?? "");
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ar = props.locale === "ar";

  async function mutate(path: string, method: "POST" | "PATCH", body: unknown) {
    const response = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) throw new Error(result?.error || (ar ? "تعذر إكمال الطلب" : "The request could not be completed"));
  }

  useEffect(() => {
    void mutate(`/api/inbox/conversations/${props.conversationId}`, "PATCH", { markRead: true })
      .then(() => router.refresh())
      .catch(() => undefined);
    // Mark once when a thread becomes active; refreshes should not create a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.conversationId]);

  async function run(name: string, operation: AsyncInboxOperation) {
    setBusy(name);
    setError(null);
    try {
      await operation();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (ar ? "حدث خطأ" : "Something went wrong"));
    } finally {
      setBusy(null);
    }
  }

  if (!props.canManage) {
    return <p className="subtitle">{ar ? "لديك صلاحية قراءة صندوق الوارد فقط." : "You have read-only inbox access."}</p>;
  }

  async function submitReply(event: FormEvent) {
    event.preventDefault();
    const text = reply.trim();
    if (!text) return;
    await run("reply", async () => {
      await mutate(`/api/inbox/conversations/${props.conversationId}/messages`, "POST", { text });
      setReply("");
    });
  }

  async function submitNote(event: FormEvent) {
    event.preventDefault();
    const body = note.trim();
    if (!body) return;
    await run("note", async () => {
      await mutate(`/api/inbox/conversations/${props.conversationId}/notes`, "POST", { body });
      setNote("");
    });
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ display: "grid", gap: 5 }}>
          <span className="eyebrow">{ar ? "التعيين" : "Assignment"}</span>
          <select value={assignee} onChange={(event) => setAssignee(event.target.value)}>
            <option value="">{ar ? "غير معيّن" : "Unassigned"}</option>
            {props.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </select>
        </label>
        <button
          className="secondary"
          disabled={busy !== null}
          type="button"
          onClick={() => void run("assign", () => mutate(`/api/inbox/conversations/${props.conversationId}`, "PATCH", { assignedUserId: assignee || null }))}
        >
          {ar ? "حفظ التعيين" : "Save assignment"}
        </button>
        <button
          className="secondary"
          disabled={busy !== null}
          type="button"
          onClick={() => void run("status", () => mutate(`/api/inbox/conversations/${props.conversationId}`, "PATCH", { status: props.status === "open" ? "closed" : "open" }))}
        >
          {props.status === "open" ? (ar ? "إغلاق المحادثة" : "Close conversation") : (ar ? "إعادة الفتح" : "Reopen conversation")}
        </button>
      </div>

      <form onSubmit={submitReply} style={{ display: "grid", gap: 8 }}>
        <label htmlFor="inbox-reply"><strong>{ar ? "رد عبر واتساب" : "Reply on WhatsApp"}</strong></label>
        <textarea
          id="inbox-reply"
          rows={4}
          maxLength={4096}
          value={reply}
          disabled={!props.replyWindowOpen || props.status === "closed" || busy !== null}
          onChange={(event) => setReply(event.target.value)}
          placeholder={props.replyWindowOpen
            ? (ar ? "اكتب رداً…" : "Write a reply…")
            : (ar ? "انتهت نافذة خدمة العملاء لمدة 24 ساعة؛ استخدم قالباً معتمداً." : "The 24-hour service window is closed; use an approved template instead.")}
        />
        <div><button className="primary" disabled={!reply.trim() || !props.replyWindowOpen || props.status === "closed" || busy !== null} type="submit">{busy === "reply" ? (ar ? "جارٍ الإرسال…" : "Sending…") : (ar ? "إرسال الرد" : "Send reply")}</button></div>
      </form>

      <form onSubmit={submitNote} style={{ display: "grid", gap: 8 }}>
        <label htmlFor="inbox-note"><strong>{ar ? "ملاحظة داخلية" : "Internal note"}</strong></label>
        <textarea id="inbox-note" rows={3} maxLength={4000} value={note} disabled={busy !== null} onChange={(event) => setNote(event.target.value)} placeholder={ar ? "هذه الملاحظة لا تُرسل للعميل." : "This note is never sent to the customer."} />
        <div><button className="secondary" disabled={!note.trim() || busy !== null} type="submit">{ar ? "إضافة ملاحظة" : "Add note"}</button></div>
      </form>

      {error ? <p role="alert" style={{ margin: 0, color: "var(--danger, #b42318)" }}>{error}</p> : null}
    </div>
  );
}
