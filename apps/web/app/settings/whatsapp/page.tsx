import { desc, eq } from "drizzle-orm";
import { schema } from "@wa/db";
import { ConnectWhatsApp } from "@/components/connect-whatsapp";
import { SettingsNav } from "@/components/settings-nav";
import { requireAuthContext } from "@/lib/auth-context";
import { getI18n } from "@/lib/i18n/server";
import { workspaceSettingsMessages } from "@/lib/i18n/workspace-settings";
import { disconnectWhatsAppNumberAction } from "@/lib/workspace-actions";
import { db, getMetaServerConfig } from "@/lib/server";
import { can } from "@/lib/workspace-access";

export default async function WhatsAppSettingsPage() {
  const [{ workspace }, i18n] = await Promise.all([requireAuthContext(), getI18n()]);
  const phoneNumbers = await db
    .select()
    .from(schema.whatsappPhoneNumbers)
    .where(eq(schema.whatsappPhoneNumbers.organizationId, workspace.organizationId))
    .orderBy(desc(schema.whatsappPhoneNumbers.createdAt));
  const meta = getMetaServerConfig();
  const canManage = can(workspace.role, "whatsapp.manage");
  const m = workspaceSettingsMessages[i18n.locale];
  const integer = new Intl.NumberFormat(i18n.localeTag, { maximumFractionDigits: 0 });

  return (
    <>
      <header className="topbar settingsHeader">
        <div><p className="eyebrow">{m.common.eyebrow}</p><h1>{m.whatsapp.title}</h1><p className="subtitle">{m.whatsapp.subtitle}</p></div>
        {canManage ? <ConnectWhatsApp appId={meta.appId} configId={meta.configId} graphApiVersion={meta.graphApiVersion} /> : null}
      </header>
      <SettingsNav active="/settings/whatsapp" />
      <section className="panel settingsPanel">
        <div className="panelHeader"><div><h2>{m.whatsapp.connectedNumbers}</h2><p className="subtitle">{m.whatsapp.connectedNumbersHelp}</p></div></div>
        {phoneNumbers.length ? <div className="settingsList">{phoneNumbers.map((phone) => (
          <div className="settingsListRow settingsPhoneRow" key={phone.id}>
            <div>
              <strong>{phone.verifiedName ?? m.whatsapp.businessFallback}</strong>
              <p>{phone.displayPhoneNumber ?? phone.phoneNumberId}</p>
              {phone.status === "disconnected" && canManage ? <small>{m.whatsapp.reconnectHint}</small> : null}
            </div>
            <div className="settingsMetrics">
              <span><small>{m.whatsapp.status}</small><strong>{phone.status}</strong></span>
              <span><small>{m.whatsapp.quality}</small><strong>{phone.qualityRating ?? "—"}</strong></span>
              <span><small>{m.whatsapp.throughput}</small><strong>{integer.format(phone.throughputMps)} {m.whatsapp.messagesPerSecond}</strong></span>
              {canManage && phone.status !== "disconnected" ? (
                <form action={disconnectWhatsAppNumberAction}>
                  <input type="hidden" name="phoneNumberId" value={phone.id} />
                  <button type="submit">{m.whatsapp.disconnect}</button>
                </form>
              ) : null}
            </div>
          </div>
        ))}</div> : <div className="emptyState"><div className="emptyIcon">W</div><h3>{m.whatsapp.noNumber}</h3><p>{m.whatsapp.noNumberHelp}</p></div>}
        {!canManage ? <p className="settingsHint">{m.whatsapp.readOnly}</p> : null}
      </section>
    </>
  );
}