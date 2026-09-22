import { describe, expect, test } from "bun:test";
import {
  createEmbeddedSignupLoginOptions,
  EmbeddedSignupAttemptTracker,
  parseEmbeddedSignupMessage,
} from "./embedded-signup-client";

describe("Embedded Signup v4 client flow", () => {
  test("uses the current configuration-driven launch payload", () => {
    const options = createEmbeddedSignupLoginOptions("config-123");
    expect(options).toEqual({
      config_id: "config-123",
      response_type: "code",
      override_default_response_type: true,
      extras: { setup: {} },
    });
    expect("sessionInfoVersion" in options.extras).toBe(false);
  });

  test("accepts a complete FINISH payload", () => {
    expect(parseEmbeddedSignupMessage("https://www.facebook.com", JSON.stringify({
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH",
      data: { waba_id: " 123456 ", phone_number_id: " 987654 ", business_id: " 555555 " },
    }))).toEqual({
      kind: "finish",
      data: { wabaId: "123456", phoneNumberId: "987654", businessId: "555555" },
    });
  });

  test("recognizes cancellation, invalid input, Meta errors, and untrusted origins", () => {
    expect(parseEmbeddedSignupMessage("https://web.facebook.com", {
      type: "WA_EMBEDDED_SIGNUP", event: "CANCEL", data: {},
    })).toEqual({ kind: "cancel" });
    expect(parseEmbeddedSignupMessage("https://www.facebook.com", {
      type: "WA_EMBEDDED_SIGNUP", event: "NOT_A_REAL_EVENT", data: {},
    })).toEqual({ kind: "invalid" });
    expect(parseEmbeddedSignupMessage("https://www.facebook.com", {
      type: "WA_EMBEDDED_SIGNUP", event: "FINISH", data: { waba_id: "123456" },
    })).toEqual({ kind: "invalid" });
    expect(parseEmbeddedSignupMessage("https://www.facebook.com", {
      type: "WA_EMBEDDED_SIGNUP", event: "ERROR", data: {},
    })).toEqual({ kind: "error" });
    expect(parseEmbeddedSignupMessage("https://example.com", {
      type: "WA_EMBEDDED_SIGNUP", event: "FINISH",
      data: { waba_id: "123456", phone_number_id: "987654" },
    })).toEqual({ kind: "ignore" });
  });

  test("does not mix late callbacks or popup messages across retry attempts", () => {
    const tracker = new EmbeddedSignupAttemptTracker();
    const sourceA = {};
    const sourceB = {};
    const attemptA = tracker.begin()!;
    expect(tracker.acceptMessage(sourceA, { kind: "cancel" })).toEqual({
      kind: "terminal", reason: "cancelled", requiresReload: false,
    });

    const attemptB = tracker.begin()!;
    expect(tracker.acceptLoginResponse(attemptA, "late-code-a")).toEqual({ kind: "ignore" });
    expect(tracker.acceptMessage(sourceA, {
      kind: "finish", data: { wabaId: "waba-a", phoneNumberId: "phone-a" },
    })).toEqual({ kind: "ignore" });

    expect(tracker.acceptLoginResponse(attemptB, "code-b")).toEqual({ kind: "pending" });
    expect(tracker.acceptMessage(sourceB, {
      kind: "finish", data: { wabaId: "waba-b", phoneNumberId: "phone-b" },
    })).toEqual({
      kind: "ready",
      attemptId: attemptB,
      code: "code-b",
      signup: { wabaId: "waba-b", phoneNumberId: "phone-b" },
    });
  });

  test("retires the popup source after a completion failure", () => {
    const tracker = new EmbeddedSignupAttemptTracker();
    const sourceA = {};
    const sourceB = {};
    const attemptA = tracker.begin()!;
    tracker.acceptLoginResponse(attemptA, "code-a");
    expect(tracker.acceptMessage(sourceA, {
      kind: "finish", data: { wabaId: "waba-a", phoneNumberId: "phone-a" },
    }).kind).toBe("ready");
    expect(tracker.completionFailed(attemptA)).toBe(false);

    const attemptB = tracker.begin()!;
    expect(tracker.acceptMessage(sourceA, {
      kind: "finish", data: { wabaId: "waba-a", phoneNumberId: "phone-a" },
    })).toEqual({ kind: "ignore" });
    tracker.acceptLoginResponse(attemptB, "code-b");
    expect(tracker.acceptMessage(sourceB, {
      kind: "finish", data: { wabaId: "waba-b", phoneNumberId: "phone-b" },
    }).kind).toBe("ready");
  });

  test("requires reload when an attempt ends before a popup source is known", () => {
    const tracker = new EmbeddedSignupAttemptTracker();
    const attempt = tracker.begin()!;
    expect(tracker.acceptLoginResponse(attempt, undefined)).toEqual({
      kind: "terminal", reason: "no_code", requiresReload: true,
    });
    expect(tracker.begin()).toBeNull();
  });
});
