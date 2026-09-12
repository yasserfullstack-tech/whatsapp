import { createHmac, timingSafeEqual } from "node:crypto";

const prefix = "sha256=";

export function verifyMetaWebhookSignature(rawBody: string, signature: string | undefined, appSecret: string): boolean {
  if (!signature?.startsWith(prefix)) return false;

  const providedHex = signature.slice(prefix.length);
  if (!/^[a-fA-F0-9]{64}$/.test(providedHex)) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  const provided = Buffer.from(providedHex, "hex");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
