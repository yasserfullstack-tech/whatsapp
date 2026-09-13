import { describe, expect, test } from "bun:test";
import { hasRecentAuthentication, RECENT_AUTH_WINDOW_MS } from "./recent-auth";

describe("recent authentication", () => {
  test("accepts a newly-created session", () => {
    const now = Date.now();
    expect(hasRecentAuthentication({ createdAt: new Date(now - 1_000) }, now)).toBe(true);
  });

  test("rejects a stale session", () => {
    const now = Date.now();
    expect(hasRecentAuthentication({ createdAt: new Date(now - RECENT_AUTH_WINDOW_MS - 1) }, now)).toBe(false);
  });
});
