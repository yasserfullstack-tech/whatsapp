import { describe, expect, test } from "bun:test";
import { can } from "./workspace-access";

describe("workspace access matrix", () => {
  test("owner can perform owner-only administration", () => {
    expect(can("owner", "team.transferOwnership")).toBe(true);
    expect(can("owner", "billing.manage")).toBe(true);
    expect(can("owner", "data.deleteWorkspace")).toBe(true);
    expect(can("owner", "contacts.restoreConsent")).toBe(true);
  });

  test("admin can administer the workspace and normal product workflows without ownership powers", () => {
    expect(can("admin", "workspace.update")).toBe(true);
    expect(can("admin", "team.invite")).toBe(true);
    expect(can("admin", "data.export")).toBe(true);
    expect(can("admin", "data.retention")).toBe(true);
    expect(can("admin", "contacts.manage")).toBe(true);
    expect(can("admin", "contacts.restoreConsent")).toBe(true);
    expect(can("admin", "audiences.manage")).toBe(true);
    expect(can("admin", "templates.manage")).toBe(true);
    expect(can("admin", "campaigns.manage")).toBe(true);
    expect(can("admin", "imports.manage")).toBe(true);
    expect(can("admin", "data.deleteWorkspace")).toBe(false);
    expect(can("admin", "team.transferOwnership")).toBe(false);
    expect(can("admin", "billing.manage")).toBe(false);
  });

  test("member can operate product workflows but cannot administer the workspace or restore consent", () => {
    expect(can("member", "contacts.manage")).toBe(true);
    expect(can("member", "audiences.manage")).toBe(true);
    expect(can("member", "templates.manage")).toBe(true);
    expect(can("member", "campaigns.manage")).toBe(true);
    expect(can("member", "imports.manage")).toBe(true);
    expect(can("member", "contacts.restoreConsent")).toBe(false);
    expect(can("member", "workspace.update")).toBe(false);
    expect(can("member", "team.invite")).toBe(false);
    expect(can("member", "whatsapp.manage")).toBe(false);
    expect(can("member", "data.export")).toBe(false);
  });

  test("viewer is read only", () => {
    for (const action of [
      "workspace.update",
      "team.invite",
      "whatsapp.manage",
      "contacts.manage",
      "contacts.restoreConsent",
      "audiences.manage",
      "templates.manage",
      "campaigns.manage",
      "imports.manage",
      "data.export",
      "data.retention",
      "data.deleteWorkspace",
    ] as const) {
      expect(can("viewer", action), `viewer must not ${action}`).toBe(false);
    }
    expect(can("viewer", "workspace.read")).toBe(true);
    expect(can("viewer", "team.read")).toBe(true);
    expect(can("viewer", "whatsapp.read")).toBe(true);
  });
});
