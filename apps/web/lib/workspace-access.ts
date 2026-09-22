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
  "inbox.read",
  "inbox.manage",
  "contacts.manage",
  "contacts.restoreConsent",
  "audiences.manage",
  "templates.manage",
  "campaigns.manage",
  "imports.manage",
  "security.read",
  "security.manage",
  "billing.read",
  "billing.manage",
  "data.read",
  "data.export",
  "data.retention",
  "data.deleteWorkspace",
  "audit.read",
] as const;
export type WorkspaceAction = (typeof workspaceActions)[number];

const productMemberActions: WorkspaceAction[] = [
  "inbox.manage",
  "contacts.manage",
  "audiences.manage",
  "templates.manage",
  "campaigns.manage",
  "imports.manage",
];

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
    "inbox.read",
    ...productMemberActions,
    "contacts.restoreConsent",
    "security.read",
    "security.manage",
    "billing.read",
    "data.read",
    "data.export",
    "data.retention",
    "audit.read",
  ]),
  member: new Set([
    "workspace.read",
    "team.read",
    "whatsapp.read",
    "inbox.read",
    ...productMemberActions,
    "security.read",
    "billing.read",
    "data.read",
  ]),
  viewer: new Set([
    "workspace.read",
    "team.read",
    "whatsapp.read",
    "inbox.read",
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
