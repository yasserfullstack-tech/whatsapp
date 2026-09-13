import { asc, eq } from "drizzle-orm";
import { schema } from "@wa/db";
import { SettingsNav } from "@/components/settings-nav";
import { requireAuthContext } from "@/lib/auth-context";
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
  const now = new Date();
  const pendingInvitations = invitations.filter(
    (invitation) => invitation.acceptedAt === null && invitation.expiresAt > now,
  );

  return (
    <>
      <header className="topbar settingsHeader">
        <div><p className="eyebrow">Workspace settings</p><h1>Team</h1><p className="subtitle">Membership and roles are scoped to this workspace only.</p></div>
        <button className="primary" disabled title="Invitation mutation is the next implementation slice" type="button">Invite member</button>
      </header>
      <SettingsNav active="/settings/team" />
      <section className="panel settingsPanel">
        <div className="panelHeader"><div><h2>Members</h2><p className="subtitle">Owner, Admin, Member, and Viewer are enforced through the shared access matrix.</p></div></div>
        <div className="settingsList">
          {members.map((member) => (
            <div className="settingsListRow" key={member.id}>
              <div><strong>{member.name || member.email}</strong><p>{member.email}</p></div>
              <span className="roleBadge">{member.role}</span>
            </div>
          ))}
        </div>
        <p className="settingsHint">{canInvite ? "Your role can invite members once the invitation mutation is connected." : "Your role has read-only team access."}</p>
      </section>
      <section className="panel settingsPanel">
        <div className="panelHeader"><div><h2>Pending invitations</h2><p className="subtitle">Invitations expire and are accepted into this workspace explicitly.</p></div></div>
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
