import { and, eq } from "drizzle-orm";
import { schema } from "@wa/db";
import { NOTIFICATION_DEFINITIONS } from "@wa/notifications";
import { SettingsNav } from "@/components/settings-nav";
import { requireAuthContext } from "@/lib/auth-context";
import { getI18n } from "@/lib/i18n/server";
import { workspaceSettingsMessages } from "@/lib/i18n/workspace-settings";
import { updateNotificationPreferencesAction } from "@/lib/notification-actions";
import { db } from "@/lib/server";
import styles from "./preferences.module.css";

export default async function NotificationSettingsPage() {
  const [{ workspace }, i18n] = await Promise.all([requireAuthContext(), getI18n()]);
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
  const m = workspaceSettingsMessages[i18n.locale];

  return (
    <>
      <header className="topbar settingsHeader">
        <div><p className="eyebrow">{m.common.eyebrow}</p><h1>{m.notifications.title}</h1><p className="subtitle">{m.notifications.subtitle}</p></div>
      </header>
      <SettingsNav active="/settings/notifications" />

      <section className="panel settingsPanel">
        <form action={updateNotificationPreferencesAction}>
          <div className={styles.table} role="table" aria-label={m.notifications.title}>
            <div className={`${styles.row} ${styles.header}`} role="row">
              <span role="columnheader">{m.notifications.event}</span><span role="columnheader">{m.notifications.inApp}</span><span role="columnheader">{m.notifications.email}</span>
            </div>
            {NOTIFICATION_DEFINITIONS.map((definition) => {
              const preference = preferenceByType.get(definition.type);
              const defaultEnabled = definition.defaultEnabled ?? true;
              const inAppEnabled = definition.mandatory || (preference ? preference.inAppEnabled : defaultEnabled);
              const emailEnabled = definition.mandatory || (preference ? preference.emailEnabled : defaultEnabled);
              return (
                <div className={styles.row} role="row" key={definition.type}>
                  <div role="cell"><strong>{definition.label[i18n.locale]}</strong><span className={styles.category}>{m.notifications.categories[definition.category]}</span>{definition.mandatory ? <span className={styles.required}>{m.notifications.required}</span> : null}</div>
                  <label role="cell" className={styles.toggle}><input type="checkbox" name={`inApp:${definition.type}`} defaultChecked={inAppEnabled} disabled={definition.mandatory} /><span>{m.notifications.inApp}</span></label>
                  <label role="cell" className={styles.toggle}><input type="checkbox" name={`email:${definition.type}`} defaultChecked={emailEnabled} disabled={definition.mandatory} /><span>{m.notifications.email}</span></label>
                </div>
              );
            })}
          </div>
          <div className={styles.footer}><button className="primary" type="submit">{m.notifications.save}</button></div>
        </form>
      </section>
    </>
  );
}
