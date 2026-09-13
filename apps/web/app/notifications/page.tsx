import Link from "next/link";
import { and, count, desc, eq } from "drizzle-orm";
import { schema } from "@wa/db";
import { AppSidebar } from "@/components/app-sidebar";
import { requireAuthContext } from "@/lib/auth-context";
import { markAllNotificationsReadAction, markNotificationReadAction } from "@/lib/notification-actions";
import { getI18n } from "@/lib/i18n/server";
import { db } from "@/lib/server";
import styles from "./notifications.module.css";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 20;

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { session, workspace } = await requireAuthContext();
  const { locale } = await getI18n();
  const params = await searchParams;
  const parsedPage = Number.parseInt(params.page ?? "1", 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const visiblePredicate = and(
    eq(schema.notifications.organizationId, workspace.organizationId),
    eq(schema.notifications.userId, workspace.userId),
    eq(schema.notificationDeliveries.channel, "in_app"),
    eq(schema.notificationDeliveries.status, "sent"),
  );

  const [rows, totalRows] = await Promise.all([
    db
      .select({
        id: schema.notifications.id,
        type: schema.notifications.type,
        title: schema.notifications.title,
        message: schema.notifications.message,
        link: schema.notifications.link,
        readAt: schema.notifications.readAt,
        createdAt: schema.notifications.createdAt,
      })
      .from(schema.notifications)
      .innerJoin(schema.notificationDeliveries, eq(schema.notificationDeliveries.notificationId, schema.notifications.id))
      .where(visiblePredicate)
      .orderBy(desc(schema.notifications.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db
      .select({ total: count() })
      .from(schema.notifications)
      .innerJoin(schema.notificationDeliveries, eq(schema.notificationDeliveries.notificationId, schema.notifications.id))
      .where(visiblePredicate),
  ]);

  const total = totalRows[0]?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const initials = workspace.organizationName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const copy = locale === "ar"
    ? { eyebrow: "مركز الإشعارات", title: "الإشعارات", subtitle: "تابع أحداث مساحة العمل المهمة دون ضوضاء على مستوى كل رسالة.", markAll: "تحديد الكل كمقروء", empty: "لا توجد إشعارات بعد.", unread: "غير مقروء", read: "مقروء", view: "عرض التفاصيل", previous: "السابق", next: "التالي" }
    : { eyebrow: "Notification center", title: "Notifications", subtitle: "Follow important workspace events without recipient-level noise.", markAll: "Mark all read", empty: "No notifications yet.", unread: "Unread", read: "Read", view: "View details", previous: "Previous", next: "Next" };

  return (
    <main className="shell">
      <AppSidebar active="notifications" workspaceName={workspace.organizationName} email={session.user.email} initials={initials} />
      <section className="content">
        <header className="topbar">
          <div><p className="eyebrow">{copy.eyebrow}</p><h1>{copy.title}</h1><p className="subtitle">{copy.subtitle}</p></div>
          {rows.some((row) => !row.readAt) ? <form action={markAllNotificationsReadAction}><button className="secondary" type="submit">{copy.markAll}</button></form> : null}
        </header>

        <section className={styles.list} aria-live="polite">
          {rows.length ? rows.map((notification) => (
            <article className={`${styles.card} ${notification.readAt ? "" : styles.unread}`} key={notification.id}>
              <div className={styles.body}>
                <div className={styles.meta}>
                  <span className={styles.type}>{notification.type.replaceAll("_", " ")}</span>
                  <span>·</span>
                  <time dateTime={notification.createdAt.toISOString()}>{new Intl.DateTimeFormat(locale === "ar" ? "ar-IQ" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(notification.createdAt)}</time>
                  <span className={notification.readAt ? styles.readState : styles.unreadState}>{notification.readAt ? copy.read : copy.unread}</span>
                </div>
                <h2>{notification.title}</h2>
                <p>{notification.message}</p>
                <div className={styles.actions}>
                  {notification.link ? <Link href={notification.link}>{copy.view} →</Link> : null}
                  {!notification.readAt ? (
                    <form action={markNotificationReadAction}>
                      <input type="hidden" name="notificationId" value={notification.id} />
                      <button type="submit" className={styles.textButton}>{copy.markAll.replace(locale === "ar" ? "الكل " : "all ", "")}</button>
                    </form>
                  ) : null}
                </div>
              </div>
            </article>
          )) : <div className={styles.empty}>{copy.empty}</div>}
        </section>

        {pages > 1 ? (
          <nav className={styles.pagination} aria-label="Notification pages">
            {page > 1 ? <Link href={`/notifications?page=${page - 1}`}>← {copy.previous}</Link> : <span />}
            <span>{Math.min(page, pages)} / {pages}</span>
            {page < pages ? <Link href={`/notifications?page=${page + 1}`}>{copy.next} →</Link> : <span />}
          </nav>
        ) : null}
      </section>
    </main>
  );
}
