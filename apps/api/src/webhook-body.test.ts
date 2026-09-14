import { describe, expect, test } from "bun:test";
import { META_WEBHOOK_MAX_BYTES, readTextBodyWithLimit } from "./webhook-body";

describe("Meta webhook request body limits", () => {
  test("accepts a body at the configured byte limit", async () => {
    const body = "a".repeat(META_WEBHOOK_MAX_BYTES);
    const result = await readTextBodyWithLimit(new Request("http://localhost/webhook", {
      method: "POST",
      body,
    }));

    expect(result).toEqual({ ok: true, text: body });
  });

  test("rejects a declared oversized body without consuming it", async () => {
    const request = new Request("http://localhost/webhook", {
      method: "POST",
      headers: { "content-length": String(META_WEBHOOK_MAX_BYTES + 1) },
      body: "small",
    });

    expect(await readTextBodyWithLimit(request)).toEqual({ ok: false, reason: "too_large" });
  });

  test("rejects chunked bodies once the actual UTF-8 byte count exceeds the limit", async () => {
    const chunk = new TextEncoder().encode("🚫".repeat(Math.ceil((META_WEBHOOK_MAX_BYTES + 4) / 4)));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.close();
      },
    });
    const request = new Request("http://localhost/webhook", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    expect(await readTextBodyWithLimit(request)).toEqual({ ok: false, reason: "too_large" });
  });
});
