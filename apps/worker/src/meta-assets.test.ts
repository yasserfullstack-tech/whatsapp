import { describe, expect, test } from "bun:test";
import {
  accountConnectionStatus,
  normalizeMetaTemplateStatus,
  normalizedPhoneDigits,
  shouldApplyMetaAssetState,
  stableFingerprint,
  webhookEventTime,
} from "./meta-assets";

describe("Meta asset state ordering", () => {
  const currentAt = new Date("2026-09-16T12:00:00.000Z");
  const currentFingerprint = stableFingerprint({ status: "approved" });

  test("rejects an older provider event after a newer state was observed", () => {
    expect(shouldApplyMetaAssetState(
      { providerEventAt: currentAt, fingerprint: currentFingerprint },
      new Date("2026-09-16T11:59:59.000Z"),
      stableFingerprint({ status: "rejected" }),
    )).toBe(false);
  });

  test("treats an exact replay as idempotent", () => {
    expect(shouldApplyMetaAssetState(
      { providerEventAt: currentAt, fingerprint: currentFingerprint },
      currentAt,
      currentFingerprint,
    )).toBe(false);
  });

  test("accepts a different state at the same provider timestamp and any newer observation", () => {
    expect(shouldApplyMetaAssetState(
      { providerEventAt: currentAt, fingerprint: currentFingerprint },
      currentAt,
      stableFingerprint({ status: "paused" }),
    )).toBe(true);

    expect(shouldApplyMetaAssetState(
      { providerEventAt: currentAt, fingerprint: currentFingerprint },
      new Date("2026-09-16T12:00:01.000Z"),
      currentFingerprint,
    )).toBe(true);
  });
});

describe("Meta asset normalization", () => {
  test("normalizes template lifecycle states used by webhook and reconciliation paths", () => {
    expect(normalizeMetaTemplateStatus("APPROVED")).toBe("approved");
    expect(normalizeMetaTemplateStatus("REJECTED")).toBe("rejected");
    expect(normalizeMetaTemplateStatus("PAUSED")).toBe("paused");
    expect(normalizeMetaTemplateStatus("DISABLED")).toBe("disabled");
    expect(normalizeMetaTemplateStatus("REINSTATED")).toBe("approved");
  });

  test("maps account ban transitions without treating review metadata as a restriction", () => {
    expect(accountConnectionStatus({ event: "DISABLED_UPDATE", banState: "FLAGGED" })).toBe("restricted");
    expect(accountConnectionStatus({ event: "DISABLED_UPDATE", banState: "REINSTATE" })).toBe("connected");
    expect(accountConnectionStatus({ event: "VERIFIED_ACCOUNT" })).toBeNull();
  });

  test("normalizes display numbers for webhook-to-phone matching", () => {
    expect(normalizedPhoneDigits("+1 (650) 555-1111")).toBe("16505551111");
  });

  test("uses webhook provider time when present and durable receipt time as fallback", () => {
    const fallback = new Date("2026-09-16T12:00:00.123Z");
    expect(webhookEventTime(1700000000, fallback).toISOString()).toBe("2023-11-14T22:13:20.000Z");
    expect(webhookEventTime(undefined, fallback)).toEqual(fallback);
  });
});
