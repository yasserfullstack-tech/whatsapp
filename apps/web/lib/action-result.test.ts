import { describe, expect, test } from "bun:test";
import {
  limitExceededMessage,
  readLimitExceeded,
  toActionResult,
} from "./action-result";

describe("limit-exceeded detection", () => {
  test("recognises the same error when the module was bundled twice", () => {
    // A second copy of the class fails instanceof but keeps its name and message.
    const foreign = Object.assign(
      new Error(
        "Billing entitlement max_members would exceed limit 3 with total 5",
      ),
      { name: "BillingLimitExceededError" },
    );
    expect(readLimitExceeded(foreign)).toEqual({ limit: 3 });
  });

  test("ignores unrelated failures", () => {
    expect(readLimitExceeded(new Error("Member not found"))).toBeNull();
    expect(readLimitExceeded("nope")).toBeNull();
  });

  test("names the limit and the way out", () => {
    expect(limitExceededMessage(3)).toContain("3 team members");
  });
});

describe("action results", () => {
  test("reports success", async () => {
    expect(await toActionResult(async () => "done")).toEqual({ ok: true });
  });

  test("carries the failure message to the page", async () => {
    const result = await toActionResult(async () => {
      throw new Error("That user is already a workspace member");
    });
    expect(result).toEqual({
      ok: false,
      error: "That user is already a workspace member",
    });
  });

  test("turns a plan limit into guidance instead of an internal message", async () => {
    const result = await toActionResult(async () => {
      const error = new Error("Billing entitlement max_members would exceed limit 3 with total 4");
      error.name = "BillingLimitExceededError";
      throw error;
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toBe(limitExceededMessage(3));
  });
});
