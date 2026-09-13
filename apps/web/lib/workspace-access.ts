export const workspaceRoles = ["owner", "admin", "member", "viewer"] as const;
export type WorkspaceRole = (typeof workspaceRoles)[number];

export const workspaceActions = [
  "workspace.read",
  "workspace.update",
  "team.read",
  "team.invite",
  "team.changeRole",
  "team.remove",
  "team.transferOwnership",
  "whatsapp.read",
  "whatsapp.manage",
  "security.read",
  "security.manage",
  "billing.read",
  "billing.manage",
  "data.read",
  "data.export",
  "audit.read",
] as const;
export type WorkspaceAction = (typeof workspaceActions)[number];

const access: Record<WorkspaceRole, ReadonlySet<WorkspaceAction>> = {
  owner: new Set(workspaceActions),
  admin: new Set([
    "workspace.read",
    "workspace.update",
    "team.read",
    "team.invite",
    "team.changeRole",
    "team.remove",
    "whatsapp.read",
    "whatsapp.manage",
    "security.read",
    "security.manage",
    "billing.read",
    "data.read",
    "data.export",
    "audit.read",
  ]),
  member: new Set([
    "workspace.read",
    "team.read",
    "whatsapp.read",
    "security.read",
    "billing.read",
    "data.read",
  ]),
  viewer: new Set([
    "workspace.read",
    "team.read",
    "whatsapp.read",
    "security.read",
    "billing.read",
    "data.read",
  ]),
};

export function can(role: WorkspaceRole, action: WorkspaceAction): boolean {
  return access[role].has(action);
}

export function requireWorkspaceAction(role: WorkspaceRole, action: WorkspaceAction): void {
  if (!can(role, action)) throw new Error(`Workspace role ${role} cannot ${action}`);
}
