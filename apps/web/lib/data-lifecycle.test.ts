import { describe, expect, test } from "bun:test";
import { createExportIdentity, isExportKind, workspaceDeletionSchedule } from "./data-lifecycle";

describe("data lifecycle helpers", () => {
  test("export object keys remain inside the tenant prefix and use an opaque file name", () => {
    const item = createExportIdentity("org-123", "Acme ../ Workspace", "contacts", new Date("2026-09-13T00:00:00Z"));
    expect(item.objectKey.startsWith("org-123/data-exports/")).toBe(true);
    expect(item.objectKey.endsWith(".ndjson")).toBe(true);
    expect(item.objectKey).not.toContain("Acme");
    expect(item.fileName).toBe("acme-workspace-contacts-2026-09-13.ndjson");
  });

  test("only known export kinds are accepted", () => {
    expect(isExportKind("workspace")).toBe(true);
    expect(isExportKind("credentials")).toBe(false);
  });

  test("workspace deletion has a seven-day cooling off period plus a disabled day", () => {
    const now = new Date("2026-09-13T10:00:00Z");
    const schedule = workspaceDeletionSchedule(now);
    expect(schedule.coolingOffEndsAt.toISOString()).toBe("2026-09-20T10:00:00.000Z");
    expect(schedule.purgeAfter.toISOString()).toBe("2026-09-21T10:00:00.000Z");
  });
});
