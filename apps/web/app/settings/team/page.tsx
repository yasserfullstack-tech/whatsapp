import { asc, eq } from "drizzle-orm";
import { schema } from "@wa/db";
import { SettingsNav } from "@/components/settings-nav";
import { requireAuthContext } from "@/lib/auth-context";
import { formatMessage } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { workspaceSettingsMessages } from "@/lib/i18n/workspace-settings";
import {
  changeWorkspaceMemberRoleAction,
  inviteWorkspaceMemberAction,
  removeWorkspaceMemberAction,
  transferWorkspaceOwnershipAction,
} from "@/lib/workspace-actions";
import { db } from "@/lib/server";
import { can } from "@/lib/workspace-access";

export default async function TeamSettingsPage() {
  const [{ workspace }, i18n] = await Promise.all([requireAuthContext(), getI18n()]);
  const [members, invitations] = await Promise.all([
    db
      .select({
        id: schema.organizationMembers.id,
        userId: schema.users.id,
        name: schema.users.displayName,
        email: schema.users.email,
        role: schema.organizationMembers.role,
        joinedAt: schema.organizationMembers.createdAt,
      })
      .from(schema.organizationMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.organizationMembers.userId))
      .where(eq(schema.organizationMembers.organizationId, workspace.organizationId))
      .orderBy(asc(schema.organizationMembers.createdAt)),
    db
      .select()
      .from(schema.organizationInvitations)
      .where(eq(schema.organizationInvitations.organizationId, workspace.organizationId))
      .orderBy(asc(schema.organizationInvitations.createdAt)),
  ]);
  const canInvite = can(workspace.role, "team.invite");
  const canChangeRole = can(workspace.role, "team.changeRole");
  const canRemove = can(workspace.role, "team.remove");
  const canTransfer = can(workspace.role, "team.transferOwnership");
  const now = new Date();
  const pendingInvitations = invitations.filter(
    (invitation) => invitation.acceptedAt === null && invitation.expiresAt > now,
  );
  const m = workspaceSettingsMessages[i18n.locale];
  const date = new Intl.DateTimeFormat(i18n.localeTag, { dateStyle: "medium" });

  return (
    <>
      <header className="topbar settingsHeader">
        <div><p className="eyebrow">{m.common.eyebrow}</p><h1>{m.team.title}</h1><p className="subtitle">{m.team.subtitle}</p></div>
      </header>
      <SettingsNav active="/settings/team" />

      {canInvite ? (
        <section className="panel settingsPanel">
          <div className="panelHeader"><div><h2>{m.team.inviteMember}</h2><p className="subtitle">{m.team.inviteHelp}</p></div></div>
          <form className="settingsFields" action={inviteWorkspaceMemberAction}>
            <label><span>{m.team.email}</span><input name="email" type="email" autoComplete="email" required maxLength={254} placeholder={m.team.emailPlaceholder} /></label>
            <label>
              <span>{m.team.role}</span>
              <select name="role" defaultValue="member">
                {workspace.role === "owner" ? <option value="admin">{m.common.roles.admin}</option> : null}
                <option value="member">{m.common.roles.member}</option>
                <option value="viewer">{m.common.roles.viewer}</option>
              </select>
            </label>
            <div><button className="primary" type="submit">{m.team.sendInvitation}</button></div>
          </form>
        </section>
      ) : null}

      <section className="panel settingsPanel">
        <div className="panelHeader"><div><h2>{m.team.members}</h2><p className="subtitle">{m.team.membersHelp}</p></div></div>
        <div className="settingsList">
          {members.map((member) => {
            const isSelf = member.userId === workspace.userId;
            const canManageAdmin = workspace.role === "owner";
            const roleEditable = canChangeRole && !isSelf && member.role !== "owner" && (member.role !== "admin" || canManageAdmin);
            const removable = canRemove && !isSelf && member.role !== "owner" && (member.role !== "admin" || canManageAdmin);
            const transferable = canTransfer && !isSelf;
            return (
              <div className="settingsListRow" key={member.id}>
                <div><strong>{member.name || member.email}{isSelf ? ` (${m.team.you})` : ""}</strong><p>{member.email}</p></div>
                <div className="settingsActions">
                  {roleEditable ? (
                    <form action={changeWorkspaceMemberRoleAction}>
                      <input type="hidden" name="membershipId" value={member.id} />
                      <select name="role" defaultValue={member.role} aria-label={formatMessage(m.team.roleFor, { email: member.email })}>
                        {canManageAdmin ? <option value="admin">{m.common.roles.admin}</option> : null}
                        <option value="member">{m.common.roles.member}</option>
                        <option value="viewer">{m.common.roles.viewer}</option>
                      </select>
                      <button type="submit">{m.team.saveRole}</button>
                    </form>
                  ) : <span className="roleBadge">{m.common.roles[member.role]}</span>}
                  {removable ? (
                    <form action={removeWorkspaceMemberAction}>
                      <input type="hidden" name="membershipId" value={member.id} />
                      <button type="submit">{m.team.remove}</button>
                    </form>
                  ) : null}
                  {transferable ? (
                    <form action={transferWorkspaceOwnershipAction}>
                      <input type="hidden" name="membershipId" value={member.id} />
                      <button type="submit">{m.team.transferOwnership}</button>
                    </form>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        {!canInvite && !canChangeRole && !canRemove ? <p className="settingsHint">{m.team.readOnly}</p> : null}
      </section>

      <section className="panel settingsPanel">
        <div className="panelHeader"><div><h2>{m.team.pendingInvitations}</h2><p className="subtitle">{m.team.pendingHelp}</p></div></div>
        {pendingInvitations.length ? <div className="settingsList">{pendingInvitations.map((invitation) => (
          <div className="settingsListRow" key={invitation.id}>
            <div><strong>{invitation.email}</strong><p>{formatMessage(m.team.expires, { date: date.format(invitation.expiresAt) })}</p></div>
            <span className="roleBadge">{m.common.roles[invitation.role]}</span>
          </div>
        ))}</div> : <p className="settingsHint">{m.team.noPending}</p>}
      </section>
    </>
  );
}
