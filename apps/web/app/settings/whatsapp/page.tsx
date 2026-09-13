import { desc, eq } from "drizzle-orm";
import { schema } from "@wa/db";
import { ConnectWhatsApp } from "@/components/connect-whatsapp";
import { SettingsNav } from "@/components/settings-nav";
import { requireAuthContext } from "@/lib/auth-context";
import { disconnectWhatsAppNumberAction } from "@/lib/workspace-actions";
import { db, getMetaServerConfig } from "@/lib/server";
import { can } from "@/lib/workspace-access";

export default async function WhatsAppSettingsPage() {
  const { workspace } = await requireAuthContext();
  const phoneNumbers = await db
    .select()
    .from(schema.whatsappPhoneNumbers)
    .where(eq(schema.whatsappPhoneNumbers.organizationId, workspace.organizationId))
    .orderBy(desc(schema.whatsappPhoneNumbers.createdAt));
  const meta = getMetaServerConfig();
  const canManage = can(workspace.role, "whatsapp.manage");

  return (
    <>
      <header className="topbar settingsHeader">
        <div><p className="eyebrow">Workspace settings</p><h1>WhatsApp</h1><p className="subtitle">Connected WABAs and phone numbers for this workspace.</p></div>
        {canManage ? <ConnectWhatsApp appId={meta.appId} configId={meta.configId} graphApiVersion={meta.graphApiVersion} /> : null}
      </header>
      <SettingsNav active="/settings/whatsapp" />
      <section className="panel settingsPanel">
        <div className="panelHeader"><div><h2>Connected numbers</h2><p className="subtitle">Status, quality, throughput, and connection controls are tenant-scoped.</p></div></div>
        {phoneNumbers.length ? <div className="settingsList">{phoneNumbers.map((phone) => (
          <div className="settingsListRow settingsPhoneRow" key={phone.id}>
            <div>
              <strong>{phone.verifiedName ?? "WhatsApp Business"}</strong>
              <p>{phone.displayPhoneNumber ?? phone.phoneNumberId}</p>
              {phone.status === "disconnected" && canManage ? <small>Use Connect WhatsApp above and select this number to reconnect it.</small> : null}
            </div>
            <div className="settingsMetrics">
              <span><small>Status</small><strong>{phone.status}</strong></span>
              <span><small>Quality</small><strong>{phone.qualityRating ?? "—"}</strong></span>
              <span><small>Throughput</small><strong>{phone.throughputMps} msg/s</strong></span>
              {canManage && phone.status !== "disconnected" ? (
                <form action={disconnectWhatsAppNumberAction}>
                  <input type="hidden" name="phoneNumberId" value={phone.id} />
                  <button type="submit">Disconnect</button>
                </form>
              ) : null}
            </div>
          </div>
        ))}</div> : <div className="emptyState"><div className="emptyIcon">W</div><h3>No WhatsApp number connected</h3><p>Use Meta Embedded Signup to connect the first number to this workspace.</p></div>}
        {!canManage ? <p className="settingsHint">Your role can view connection health but cannot connect or disconnect numbers.</p> : null}
      </section>
    </>
  );
}
