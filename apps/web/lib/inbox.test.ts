import { describe, expect, test } from "bun:test";
import { canSendAgentReply, inboxMessagePreview } from "./inbox";

describe("inbox helpers", () => {
  test("allows free-form agent replies only inside the 24-hour customer service window", () => {
    const now = new Date("2026-09-16T18:00:00.000Z");
    expect(canSendAgentReply(new Date("2026-09-15T18:00:00.000Z"), now)).toBe(true);
    expect(canSendAgentReply(new Date("2026-09-15T17:59:59.999Z"), now)).toBe(false);
    expect(canSendAgentReply(null, now)).toBe(false);
  });

  test("uses text, media caption, then type for thread previews", () => {
    expect(inboxMessagePreview({ text: " hello ", mediaCaption: "caption", messageType: "image" })).toBe("hello");
    expect(inboxMessagePreview({ text: null, mediaCaption: " receipt ", messageType: "image" })).toBe("receipt");
    expect(inboxMessagePreview({ text: null, mediaCaption: null, messageType: "audio" })).toBe("[audio]");
  });
});
