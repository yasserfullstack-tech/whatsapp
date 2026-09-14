export const META_WEBHOOK_MAX_BYTES = 1024 * 1024;

type BodyReadResult =
  | { ok: true; text: string }
  | { ok: false; reason: "too_large" };

export async function readTextBodyWithLimit(
  request: Request,
  maxBytes = META_WEBHOOK_MAX_BYTES,
): Promise<BodyReadResult> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    const parsed = Number(declaredLength);
    if (Number.isFinite(parsed) && parsed > maxBytes) {
      return { ok: false, reason: "too_large" };
    }
  }

  if (!request.body) return { ok: true, text: "" };

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too_large" };
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return { ok: true, text: chunks.join("") };
  } finally {
    reader.releaseLock();
  }
}
