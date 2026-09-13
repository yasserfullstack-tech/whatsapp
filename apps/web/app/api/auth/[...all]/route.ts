import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/server";

const MAX_AUTH_BODY_BYTES = 64 * 1024;
const handlers = toNextJsHandler(auth);

export const GET = handlers.GET;

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_AUTH_BODY_BYTES) {
    return Response.json({ error: "Request body too large" }, { status: 413 });
  }

  if (!request.body) return handlers.POST(request);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_AUTH_BODY_BYTES) {
      await reader.cancel();
      return Response.json({ error: "Request body too large" }, { status: 413 });
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const headers = new Headers(request.headers);
  headers.set("content-length", String(total));

  const limitedRequest = new Request(request.url, {
    method: request.method,
    headers,
    body,
    signal: request.signal,
  });

  return handlers.POST(limitedRequest);
}
