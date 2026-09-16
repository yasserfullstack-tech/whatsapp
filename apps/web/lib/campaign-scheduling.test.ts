import { describe, expect, test } from "bun:test";
import {
  formatDateTimeLocalInZone,
  parseCampaignScheduledAt,
  zonedLocalDateTimeToInstant,
} from "./campaign-scheduling";

describe("campaign scheduling time contract", () => {
  test("converts workspace wall-clock time to one absolute instant", () => {
    expect(zonedLocalDateTimeToInstant("2026-01-15T15:00", "Asia/Baghdad").toISOString())
      .toBe("2026-01-15T12:00:00.000Z");
    expect(zonedLocalDateTimeToInstant("2026-01-15T07:00", "America/New_York").toISOString())
      .toBe("2026-01-15T12:00:00.000Z");
  });

  test("round-trips persisted instants for rescheduling controls", () => {
    const instant = new Date("2026-06-01T09:30:00.000Z");
    const local = formatDateTimeLocalInZone(instant, "Asia/Baghdad");
    expect(local).toBe("2026-06-01T12:30");
    expect(zonedLocalDateTimeToInstant(local, "Asia/Baghdad").toISOString()).toBe(instant.toISOString());
  });

  test("rejects nonexistent DST wall-clock times instead of silently shifting", () => {
    expect(() => zonedLocalDateTimeToInstant("2026-03-08T02:30", "America/New_York"))
      .toThrow("does not exist");
  });

  test("requires explicit offsets at the API boundary and rejects past instants", () => {
    const now = new Date("2026-01-15T12:00:00.000Z");
    expect(parseCampaignScheduledAt("2026-01-15T15:30:00+03:00", now)?.toISOString())
      .toBe("2026-01-15T12:30:00.000Z");
    expect(() => parseCampaignScheduledAt("2026-01-15T15:30:00", now)).toThrow("timezone offset");
    expect(() => parseCampaignScheduledAt("2026-01-15T14:30:00+03:00", now)).toThrow("future");
  });
});
