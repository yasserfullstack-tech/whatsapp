import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const preload = resolve(import.meta.dir, "runtime-preload.cjs");
const metaPort = Number(process.env.E2E_META_PORT ?? 4777);
const storagePort = Number(process.env.E2E_STORAGE_PORT ?? 4569);
const bucket = process.env.R2_BUCKET ?? "wa-e2e";

const objects = new Map<string, { body: Uint8Array; contentType: string; etag: string }>();
const metaMessages: unknown[] = [];
let templateCounter = 0;
let messageCounter = 0;

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,HEAD,PUT,POST,DELETE,OPTIONS",
  "access-control-allow-headers": "*",
  "access-control-expose-headers": "etag,content-length,content-type",
};

function xml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function objectKey(url: URL): string {
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0] === bucket) segments.shift();
  return decodeURIComponent(segments.join("/"));
}

const storageServer = Bun.serve({
  hostname: "127.0.0.1",
  port: storagePort,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ ok: true }, { headers: corsHeaders });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

    if (request.method === "GET" && url.searchParams.get("list-type") === "2") {
      const prefix = url.searchParams.get("prefix") ?? "";
      const matches = [...objects.entries()].filter(([key]) => key.startsWith(prefix));
      const contents = matches.map(([key, value]) => `<Contents><Key>${xml(key)}</Key><LastModified>${new Date().toISOString()}</LastModified><ETag>\"${value.etag}\"</ETag><Size>${value.body.byteLength}</Size><StorageClass>STANDARD</StorageClass></Contents>`).join("");
      const body = `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${xml(bucket)}</Name><Prefix>${xml(prefix)}</Prefix><KeyCount>${matches.length}</KeyCount><MaxKeys>500</MaxKeys><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`;
      return new Response(body, { headers: { ...corsHeaders, "content-type": "application/xml" } });
    }

    const key = objectKey(url);
    if (!key) return new Response("Not found", { status: 404, headers: corsHeaders });

    if (request.method === "PUT") {
      const body = new Uint8Array(await request.arrayBuffer());
      const etag = `e2e-${body.byteLength}-${Date.now()}`;
      objects.set(key, { body, contentType: request.headers.get("content-type") ?? "application/octet-stream", etag });
      return new Response(null, { status: 200, headers: { ...corsHeaders, etag: `\"${etag}\"` } });
    }

    const stored = objects.get(key);
    if (request.method === "HEAD") {
      if (!stored) return new Response(null, { status: 404, headers: corsHeaders });
      return new Response(null, { status: 200, headers: { ...corsHeaders, "content-length": String(stored.body.byteLength), "content-type": stored.contentType, etag: `\"${stored.etag}\"` } });
    }
    if (request.method === "GET") {
      if (!stored) return new Response("Not found", { status: 404, headers: corsHeaders });
      return new Response(stored.body, { status: 200, headers: { ...corsHeaders, "content-type": stored.contentType, etag: `\"${stored.etag}\"` } });
    }
    if (request.method === "DELETE") {
      objects.delete(key);
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    return new Response("Unsupported", { status: 405, headers: corsHeaders });
  },
});

const metaServer = Bun.serve({
  hostname: "127.0.0.1",
  port: metaPort,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ ok: true });
    if (url.pathname === "/__e2e/messages") return Response.json({ messages: metaMessages });
    if (url.pathname === "/__e2e/reset" && request.method === "POST") {
      metaMessages.length = 0;
      objects.clear();
      return Response.json({ ok: true });
    }

    const parts = url.pathname.split("/").filter(Boolean);
    const resource = parts.slice(1);
    if (resource[0] === "oauth" && resource[1] === "access_token") {
      return Response.json({ access_token: "e2e-meta-token", token_type: "bearer", expires_in: 3600 });
    }

    const id = resource[0];
    const action = resource[1];
    if (!id) return Response.json({ error: { message: "missing id" } }, { status: 400 });

    if (request.method === "GET" && !action) {
      return Response.json({
        id,
        display_phone_number: "+15550102030",
        verified_name: "E2E WhatsApp",
        quality_rating: "GREEN",
        platform_type: "CLOUD_API",
        throughput: { level: "STANDARD" },
      });
    }

    if (action === "subscribed_apps" && request.method === "POST") return Response.json({ success: true });

    if (action === "message_templates" && request.method === "GET") {
      return Response.json({
        data: [{
          id: "e2e-template-approved",
          name: "e2e_synced_template",
          language: "en_US",
          status: "APPROVED",
          category: "MARKETING",
          components: [{ type: "BODY", text: "Hello {{1}} from E2E" }],
        }],
      });
    }

    if (action === "message_templates" && request.method === "POST") {
      templateCounter += 1;
      return Response.json({ id: `e2e-created-template-${templateCounter}`, status: "PENDING", category: "MARKETING" });
    }

    if (action === "messages" && request.method === "POST") {
      const payload = await request.json().catch(() => null);
      metaMessages.push(payload);
      messageCounter += 1;
      const to = payload && typeof payload === "object" && "to" in payload ? String((payload as { to: unknown }).to) : "15550102030";
      return Response.json({ messages: [{ id: `wamid.e2e-${messageCounter}` }], contacts: [{ wa_id: to.replace(/^\+/, "") }] });
    }

    return Response.json({ error: { message: `Unhandled fake Meta route ${request.method} ${url.pathname}` } }, { status: 404 });
  },
});

const childEnv = {
  ...process.env,
  NODE_ENV: "test",
  HOSTNAME: "127.0.0.1",
  PORT: "3000",
  E2E_META_BASE_URL: `http://127.0.0.1:${metaPort}`,
  E2E_BLOCK_EXTERNAL: "1",
  R2_ENDPOINT: `http://127.0.0.1:${storagePort}`,
  R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID ?? "e2e",
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID ?? "e2e-access",
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY ?? "e2e-secret",
  R2_BUCKET: bucket,
};

function spawn(command: string[], cwd = root) {
  return Bun.spawn(command, { cwd, env: childEnv, stdout: "inherit", stderr: "inherit", stdin: "inherit" });
}

const webDir = resolve(root, "apps/web");
const standaloneWebDir = resolve(webDir, ".next/standalone/apps/web");
const standaloneServer = resolve(standaloneWebDir, "server.js");
if (!existsSync(standaloneServer)) {
  throw new Error(`Missing standalone Next server at ${standaloneServer}. Run bun run build before bun run test:e2e.`);
}

const sourceStatic = resolve(webDir, ".next/static");
const standaloneStatic = resolve(standaloneWebDir, ".next/static");
if (existsSync(sourceStatic)) {
  mkdirSync(resolve(standaloneWebDir, ".next"), { recursive: true });
  rmSync(standaloneStatic, { recursive: true, force: true });
  cpSync(sourceStatic, standaloneStatic, { recursive: true });
}

const sourcePublic = resolve(webDir, "public");
const standalonePublic = resolve(standaloneWebDir, "public");
if (existsSync(sourcePublic)) {
  rmSync(standalonePublic, { recursive: true, force: true });
  cpSync(sourcePublic, standalonePublic, { recursive: true });
}

const web = spawn(["node", "--require", preload, standaloneServer], standaloneWebDir);
const api = spawn(["bun", "--preload", preload, resolve(root, "apps/api/src/index.ts")]);
const worker = spawn(["bun", "--preload", preload, resolve(root, "apps/worker/src/entry.ts")]);
const children = [web, api, worker];

let closing = false;
async function shutdown(exitCode = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill();
  storageServer.stop(true);
  metaServer.stop(true);
  await Promise.allSettled(children.map((child) => child.exited));
  process.exit(exitCode);
}

process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));
process.on("exit", () => {
  for (const child of children) child.kill();
});

for (const child of children) {
  void child.exited.then((code) => {
    if (!closing && code !== 0) void shutdown(code || 1);
  });
}

console.log(`[e2e] fake Meta http://127.0.0.1:${metaPort}; fake object storage http://127.0.0.1:${storagePort}`);
await new Promise(() => {});
