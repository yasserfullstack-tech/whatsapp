import { asc, eq } from "drizzle-orm";
import { schema } from "@wa/db";
import { SettingsNav } from "@/components/settings-nav";
import { requireAuthContext } from "@/lib/auth-context";
import {
  changeWorkspaceMemberRoleAction,
  inviteWorkspaceMemberAction,
  removeWorkspaceMemberAction,
  transferWorkspaceOwnershipAction,
} from "@/lib/workspace-actions";
import { db } from "@/lib/server";
import { can } from "@/lib/workspace-access";

export default async function TeamSettingsPage() {
  const { workspace } = await requireAuthContext();
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

  return (
    <>
      <header className="topbar settingsHeader">
        <div><p className="eyebrow">Workspace settings</p><h1>Team</h1><p className="subtitle">Membership and roles are scoped to this workspace only.</p></div>
      </header>
      <SettingsNav active="/settings/team" />

      {canInvite ? (
        <section className="panel settingsPanel">
          <div className="panelHeader"><div><h2>Invite member</h2><p className="subtitle">Invitations expire after seven days and can only be accepted by the invited email address.</p></div></div>
          <form className="settingsFields" action={inviteWorkspaceMemberAction}>
            <label><span>Email</span><input name="email" type="email" autoComplete="email" required maxLength={254} placeholder="teammate@example.com" /></label>
            <label>
              <span>Role</span>
              <select name="role" defaultValue="member">
                {workspace.role === "owner" ? <option value="admin">Admin</option> : null}
                <option value="member">Member</option>
                <option value="viewer">Viewer</option>
              </select>
            </label>
            <div><button className="primary" type="submit">Send invitation</button></div>
          </form>
        </section>
      ) : null}

      <section className="panel settingsPanel">
        <div className="panelHeader"><div><h2>Members</h2><p className="subtitle">Owner, Admin, Member, and Viewer permissions are enforced server-side.</p></div></div>
        <div className="settingsList">
          {members.map((member) => {
            const isSelf = member.userId === workspace.userId;
            const canManageAdmin = workspace.role === "owner";
            const roleEditable = canChangeRole && !isSelf && member.role !== "owner" && (member.role !== "admin" || canManageAdmin);
            const removable = canRemove && !isSelf && member.role !== "owner" && (member.role !== "admin" || canManageAdmin);
            const transferable = canTransfer && !isSelf;
            return (
              <div className="settingsListRow" key={member.id}>
                <div><strong>{member.name || member.email}{isSelf ? " (you)" : ""}</strong><p>{member.email}</p></div>
                <div className="settingsActions">
                  {roleEditable ? (
                    <form action={changeWorkspaceMemberRoleAction}>
                      <input type="hidden" name="membershipId" value={member.id} />
                      <select name="role" defaultValue={member.role} aria-label={`Role for ${member.email}`}>
                        {canManageAdmin ? <option value="admin">Admin</option> : null}
                        <option value="member">Member</option>
                        <option value="viewer">Viewer</option>
                      </select>
                      <button type="submit">Save role</button>
                    </form>
                  ) : <span className="roleBadge">{member.role}</span>}
                  {removable ? (
                    <form action={removeWorkspaceMemberAction}>
                      <input type="hidden" name="membershipId" value={member.id} />
                      <button type="submit">Remove</button>
                    </form>
                  ) : null}
                  {transferable ? (
                    <form action={transferWorkspaceOwnershipAction}>
                      <input type="hidden" name="membershipId" value={member.id} />
                      <button type="submit">Transfer ownership</button>
                    </form>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        {!canInvite && !canChangeRole && !canRemove ? <p className="settingsHint">Your role has read-only team access.</p> : null}
      </section>

      <section className="panel settingsPanel">
        <div className="panelHeader"><div><h2>Pending invitations</h2><p className="subtitle">Only unexpired, unaccepted invitations are shown.</p></div></div>
        {pendingInvitations.length ? <div className="settingsList">{pendingInvitations.map((invitation) => (
          <div className="settingsListRow" key={invitation.id}>
            <div><strong>{invitation.email}</strong><p>Expires {invitation.expiresAt.toLocaleDateString()}</p></div>
            <span className="roleBadge">{invitation.role}</span>
          </div>
        ))}</div> : <p className="settingsHint">No pending invitations.</p>}
      </section>
    </>
  );
}
