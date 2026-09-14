import { describe, expect, test } from "bun:test";
import { can } from "./workspace-access";

describe("workspace access matrix", () => {
  test("owner can perform owner-only administration", () => {
    expect(can("owner", "team.transferOwnership")).toBe(true);
    expect(can("owner", "billing.manage")).toBe(true);
    expect(can("owner", "data.deleteWorkspace")).toBe(true);
  });

  test("admin can manage retention and exports without taking ownership", () => {
    expect(can("admin", "workspace.update")).toBe(true);
    expect(can("admin", "team.invite")).toBe(true);
    expect(can("admin", "data.export")).toBe(true);
    expect(can("admin", "data.retention")).toBe(true);
    expect(can("admin", "data.deleteWorkspace")).toBe(false);
    expect(can("admin", "team.transferOwnership")).toBe(false);
    expect(can("admin", "billing.manage")).toBe(false);
  });

  test("member and viewer settings access is read only", () => {
    for (const role of ["member", "viewer"] as const) {
      expect(can(role, "workspace.read")).toBe(true);
      expect(can(role, "team.read")).toBe(true);
      expect(can(role, "whatsapp.read")).toBe(true);
      expect(can(role, "workspace.update")).toBe(false);
      expect(can(role, "team.invite")).toBe(false);
      expect(can(role, "whatsapp.manage")).toBe(false);
      expect(can(role, "data.export")).toBe(false);
      expect(can(role, "data.retention")).toBe(false);
      expect(can(role, "data.deleteWorkspace")).toBe(false);
    }
  });
});
