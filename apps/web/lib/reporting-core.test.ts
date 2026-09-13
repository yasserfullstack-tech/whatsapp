import { describe, expect, test } from "bun:test";
import { parseReportFilters, percent, ratio, toCsv } from "./reporting-core";

describe("reporting core", () => {
  test("resolves date presets in the workspace timezone", () => {
    const now = new Date("2026-09-13T21:30:00Z");
    expect(parseReportFilters({ range: "today" }, "Asia/Baghdad", now)).toMatchObject({
      range: "today",
      fromDate: "2026-09-14",
      toDate: "2026-09-14",
    });
    expect(parseReportFilters({ range: "7d" }, "UTC", now)).toMatchObject({
      fromDate: "2026-09-07",
      toDate: "2026-09-13",
    });
  });

  test("normalizes custom ranges and ignores invalid tenant resource ids", () => {
    expect(parseReportFilters({ range: "custom", from: "2026-09-20", to: "2026-09-01", campaign: "not-a-uuid" }, "UTC")).toMatchObject({
      fromDate: "2026-09-01",
      toDate: "2026-09-20",
      campaignId: undefined,
    });
  });

  test("calculates defensive rates", () => {
    expect(ratio(9, 10)).toBe(0.9);
    expect(ratio(1, 0)).toBe(0);
    expect(percent(0.917)).toBe("91.7%");
  });

  test("exports RFC-compatible CSV cells with a UTF-8 BOM", () => {
    const csv = toCsv(["Campaign", "Note"], [["Hello, world", "quoted \"value\""]]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"Hello, world"');
    expect(csv).toContain('"quoted ""value"""');
  });
});
