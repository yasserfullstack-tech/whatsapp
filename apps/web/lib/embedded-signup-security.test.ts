import { describe, expect, test } from "bun:test";
import {
  assertEmbeddedSignupWabaPhoneMatch,
  EmbeddedSignupConflictError,
  EmbeddedSignupWabaPhoneMismatchError,
  verifyEmbeddedSignupPhone,
} from "./embedded-signup-security";

describe("embedded signup tenant boundary", () => {
  test("requires the verified phone to belong to the WABA returned by the same signup", () => {
    expect(() => assertEmbeddedSignupWabaPhoneMatch({
      requestedPhoneNumberId: "phone-selected",
      wabaPhoneNumberIds: ["phone-other"],
    })).toThrow(EmbeddedSignupWabaPhoneMismatchError);

    expect(() => assertEmbeddedSignupWabaPhoneMatch({
      requestedPhoneNumberId: "phone-selected",
      wabaPhoneNumberIds: ["phone-other", "phone-selected"],
    })).not.toThrow();
  });

  test("does not query local phone ownership until Meta proves control of the requested phone", async () => {
    let lookups = 0;

    await expect(verifyEmbeddedSignupPhone({
      organizationId: "org-a",
      requestedPhoneNumberId: "phone-victim",
      exchangeCode: async () => {
        throw new Error("invalid signup code");
      },
      getPhone: async () => ({ id: "phone-victim" }),
      findOrganizationByPhoneNumberId: async () => {
        lookups += 1;
        return "org-b";
      },
    })).rejects.toThrow("invalid signup code");

    expect(lookups).toBe(0);
  });

  test("rejects a foreign connection only after the verified phone identity matches the requested id", async () => {
    const calls: string[] = [];

    await expect(verifyEmbeddedSignupPhone({
      organizationId: "org-a",
      requestedPhoneNumberId: "phone-victim",
      exchangeCode: async () => {
        calls.push("exchange");
        return { accessToken: "test-token" };
      },
      getPhone: async () => {
        calls.push("get-phone");
        return { id: "phone-victim" };
      },
      findOrganizationByPhoneNumberId: async () => {
        calls.push("lookup");
        return "org-b";
      },
    })).rejects.toBeInstanceOf(EmbeddedSignupConflictError);

    expect(calls).toEqual(["exchange", "get-phone", "lookup"]);
  });

  test("does not perform a tenant lookup for a mismatched Meta phone id", async () => {
    let lookups = 0;
    await expect(verifyEmbeddedSignupPhone({
      organizationId: "org-a",
      requestedPhoneNumberId: "requested-phone",
      exchangeCode: async () => ({ accessToken: "test-token" }),
      getPhone: async () => ({ id: "different-phone" }),
      findOrganizationByPhoneNumberId: async () => {
        lookups += 1;
        return "org-b";
      },
    })).rejects.toThrow("Meta returned a different WhatsApp phone number");
    expect(lookups).toBe(0);
  });
});
