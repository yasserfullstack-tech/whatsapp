import { desc, eq } from "drizzle-orm";
import { schema } from "@wa/db";
import { AdminBadge, AdminSection } from "@/components/admin-ui";
import { setUserDisabledAction } from "@/lib/admin-actions";
import { db } from "@/lib/server";

export default async function AdminUsersPage() {
  const users = await db.select({
    id: schema.users.id,
    email: schema.users.email,
    displayName: schema.users.displayName,
    createdAt: schema.users.createdAt,
    organizationName: schema.organizations.name,
    role: schema.organizationMembers.role,
    disabled: schema.platformUserControls.disabled,
    disabledReason: schema.platformUserControls.disabledReason,
  }).from(schema.users)
    .leftJoin(schema.organizationMembers, eq(schema.organizationMembers.userId, schema.users.id))
    .leftJoin(schema.organizations, eq(schema.organizations.id, schema.organizationMembers.organizationId))
    .leftJoin(schema.platformUserControls, eq(schema.platformUserControls.userId, schema.users.id))
    .orderBy(desc(schema.users.createdAt));

  return <>
    <header className="admin-header"><div><h1>Users</h1><p>Customer application users. Platform-admin grants are separate and are not inferred from workspace roles.</p></div></header>
    <AdminSection title={`${users.length.toLocaleString()} users`}>
      <table className="admin-table"><thead><tr><th>User</th><th>Organization</th><th>Workspace role</th><th>Status</th><th>Action</th></tr></thead><tbody>{users.map((user) => <tr key={`${user.id}-${user.organizationName ?? "none"}`}>
        <td><strong>{user.displayName ?? "—"}</strong><br /><small>{user.email}</small></td><td>{user.organizationName ?? "—"}</td><td>{user.role ?? "—"}</td>
        <td><AdminBadge tone={user.disabled ? "bad" : "good"}>{user.disabled ? "disabled" : "active"}</AdminBadge>{user.disabledReason ? <><br /><small>{user.disabledReason}</small></> : null}</td>
        <td><form className="admin-actions" action={setUserDisabledAction}><input type="hidden" name="userId" value={user.id} /><input type="hidden" name="disabled" value={user.disabled ? "false" : "true"} />{user.disabled ? null : <input name="reason" aria-label="Disable reason" placeholder="Reason" />}<button className={`admin-button ${user.disabled ? "admin-button-secondary" : "admin-button-danger"}`} type="submit">{user.disabled ? "Re-enable" : "Disable user"}</button></form></td>
      </tr>)}</tbody></table>
    </AdminSection>
  </>;
}
