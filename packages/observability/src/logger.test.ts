import { describe, expect, test } from "bun:test";
import { sanitizeForLog } from "./logger";

describe("sanitizeForLog", () => {
  test("redacts sensitive keys recursively", () => {
    expect(sanitizeForLog({
      metaAccessToken: "top-secret",
      nested: { password: "hunter2", organizationId: "org_1" },
      safe: "value",
    })).toEqual({
      metaAccessToken: "[REDACTED]",
      nested: { password: "[REDACTED]", organizationId: "org_1" },
      safe: "value",
    });
  });

  test("scrubs credentials embedded in strings", () => {
    const result = sanitizeForLog({
      message: "failed postgres://user:pass@db.internal/app with Bearer abc.def and ?token=secret",
    });
    expect(String(result.message)).not.toContain("pass");
    expect(String(result.message)).not.toContain("abc.def");
    expect(String(result.message)).not.toContain("token=secret");
  });
});
