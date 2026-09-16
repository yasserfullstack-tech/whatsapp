import { describe, expect, test } from "bun:test";
import {
  createEmbeddedSignupLoginOptions,
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
      data: {
        waba_id: " 123456 ",
        phone_number_id: " 987654 ",
        business_id: " 555555 ",
      },
    }))).toEqual({
      kind: "finish",
      data: {
        wabaId: "123456",
        phoneNumberId: "987654",
        businessId: "555555",
      },
    });
  });

  test("recognizes a cancelled signup", () => {
    expect(parseEmbeddedSignupMessage("https://web.facebook.com", {
      type: "WA_EMBEDDED_SIGNUP",
      event: "CANCEL",
      data: { current_step: "PHONE_NUMBER_SETUP" },
    })).toEqual({ kind: "cancel" });
  });

  test("rejects an invalid Embedded Signup event", () => {
    expect(parseEmbeddedSignupMessage("https://www.facebook.com", {
      type: "WA_EMBEDDED_SIGNUP",
      event: "NOT_A_REAL_EVENT",
      data: {},
    })).toEqual({ kind: "invalid" });
  });

  test("rejects an incomplete FINISH payload", () => {
    expect(parseEmbeddedSignupMessage("https://www.facebook.com", {
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH",
      data: { waba_id: "123456" },
    })).toEqual({ kind: "invalid" });
  });

  test("recognizes a Meta-reported signup error", () => {
    expect(parseEmbeddedSignupMessage("https://www.facebook.com", {
      type: "WA_EMBEDDED_SIGNUP",
      event: "ERROR",
      data: { error_message: "Meta reported an error" },
    })).toEqual({ kind: "error" });
  });

  test("ignores messages from non-Meta origins", () => {
    expect(parseEmbeddedSignupMessage("https://example.com", {
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH",
      data: { waba_id: "123456", phone_number_id: "987654" },
    })).toEqual({ kind: "ignore" });
  });
});
