import { createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { verifyMetaWebhookSignature } from "./webhook-signature";

describe("verifyMetaWebhookSignature", () => {
  test("accepts a matching sha256 HMAC", () => {
    const body = JSON.stringify({ object: "whatsapp_business_account" });
    const secret = "test-app-secret";
    const digest = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyMetaWebhookSignature(body, `sha256=${digest}`, secret)).toBe(true);
  });

  test("rejects missing, malformed, and incorrect signatures", () => {
    const body = "{}";
    expect(verifyMetaWebhookSignature(body, undefined, "secret")).toBe(false);
    expect(verifyMetaWebhookSignature(body, "sha1=abc", "secret")).toBe(false);
    expect(verifyMetaWebhookSignature(body, `sha256=${"0".repeat(64)}`, "secret")).toBe(false);
  });
});
