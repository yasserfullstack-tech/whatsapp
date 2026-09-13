import { and, eq } from "drizzle-orm";
import { schema } from "@wa/db";
import { NOTIFICATION_DEFINITIONS } from "@wa/notifications";
import { SettingsNav } from "@/components/settings-nav";
import { requireAuthContext } from "@/lib/auth-context";
import { getI18n } from "@/lib/i18n/server";
import { updateNotificationPreferencesAction } from "@/lib/notification-actions";
import { db } from "@/lib/server";
import styles from "./preferences.module.css";

export default async function NotificationSettingsPage() {
  const { workspace } = await requireAuthContext();
  const { locale } = await getI18n();
  const rows = await db
    .select({
      type: schema.notificationPreferences.type,
      inAppEnabled: schema.notificationPreferences.inAppEnabled,
      emailEnabled: schema.notificationPreferences.emailEnabled,
    })
    .from(schema.notificationPreferences)
    .where(and(
      eq(schema.notificationPreferences.organizationId, workspace.organizationId),
      eq(schema.notificationPreferences.userId, workspace.userId),
    ));
  const preferenceByType = new Map(rows.map((row) => [row.type, row]));
  const copy = locale === "ar"
    ? { eyebrow: "إعدادات مساحة العمل", title: "الإشعارات", subtitle: "تحكم في الإشعارات غير الحرجة. تبقى إشعارات الأمان والحساب المهمة مفعلة.", event: "الحدث", inApp: "داخل التطبيق", email: "البريد الإلكتروني", required: "مطلوب", save: "حفظ التفضيلات" }
    : { eyebrow: "Workspace settings", title: "Notifications", subtitle: "Control non-critical notifications. Important security and account notifications remain enabled.", event: "Event", inApp: "In-app", email: "Email", required: "Required", save: "Save preferences" };

  return (
    <>
      <header className="topbar settingsHeader">
        <div><p className="eyebrow">{copy.eyebrow}</p><h1>{copy.title}</h1><p className="subtitle">{copy.subtitle}</p></div>
      </header>
      <SettingsNav active="/settings/notifications" />

      <section className="panel settingsPanel">
        <form action={updateNotificationPreferencesAction}>
          <div className={styles.table} role="table" aria-label={copy.title}>
            <div className={`${styles.row} ${styles.header}`} role="row">
              <span role="columnheader">{copy.event}</span><span role="columnheader">{copy.inApp}</span><span role="columnheader">{copy.email}</span>
            </div>
            {NOTIFICATION_DEFINITIONS.map((definition) => {
              const preference = preferenceByType.get(definition.type);
              const inAppEnabled = definition.mandatory || preference?.inAppEnabled !== false;
              const emailEnabled = definition.mandatory || preference?.emailEnabled !== false;
              return (
                <div className={styles.row} role="row" key={definition.type}>
                  <div role="cell"><strong>{definition.label[locale]}</strong><span className={styles.category}>{definition.category}</span>{definition.mandatory ? <span className={styles.required}>{copy.required}</span> : null}</div>
                  <label role="cell" className={styles.toggle}><input type="checkbox" name={`inApp:${definition.type}`} defaultChecked={inAppEnabled} disabled={definition.mandatory} /><span>{copy.inApp}</span></label>
                  <label role="cell" className={styles.toggle}><input type="checkbox" name={`email:${definition.type}`} defaultChecked={emailEnabled} disabled={definition.mandatory} /><span>{copy.email}</span></label>
                </div>
              );
            })}
          </div>
          <div className={styles.footer}><button className="primary" type="submit">{copy.save}</button></div>
        </form>
      </section>
    </>
  );
}
