import { describe, expect, test } from "bun:test";
import { inboxMessageStatusAfter, normalizeWhatsappPhone } from "./inbox";

describe("inbox webhook normalization", () => {
  test("normalizes WhatsApp sender identifiers to E.164-shaped values", () => {
    expect(normalizeWhatsappPhone("15550123")).toBe("+15550123");
    expect(normalizeWhatsappPhone("+1 (555) 0123")).toBe("+15550123");
    expect(normalizeWhatsappPhone("---")).toBeNull();
  });

  test("keeps delivery state monotonic for agent replies", () => {
    expect(inboxMessageStatusAfter("submitted", "sent")).toBe("sent");
    expect(inboxMessageStatusAfter("sent", "delivered")).toBe("delivered");
    expect(inboxMessageStatusAfter("delivered", "read")).toBe("read");
    expect(inboxMessageStatusAfter("read", "sent")).toBe("read");
    expect(inboxMessageStatusAfter("delivered", "failed")).toBe("delivered");
    expect(inboxMessageStatusAfter("failed", "read")).toBe("failed");
  });
});
