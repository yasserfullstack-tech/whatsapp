const originalFetch = globalThis.fetch.bind(globalThis);
const fakeMetaBase = process.env.E2E_META_BASE_URL;
const blockExternal = process.env.E2E_BLOCK_EXTERNAL === "1";

function isLoopback(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

globalThis.fetch = async function e2eSafeFetch(input, init) {
  let url;
  try {
    url = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url);
  } catch {
    return originalFetch(input, init);
  }

  if (url.hostname === "graph.facebook.com") {
    if (!fakeMetaBase) throw new Error(`E2E blocked Meta request without a fake endpoint: ${url}`);
    const rewritten = new URL(fakeMetaBase);
    rewritten.pathname = url.pathname;
    rewritten.search = url.search;
    const nextInput = typeof input === "object" && input !== null && !(input instanceof URL)
      ? new Request(rewritten, input)
      : rewritten;
    return originalFetch(nextInput, init);
  }

  if (blockExternal && (url.protocol === "http:" || url.protocol === "https:") && !isLoopback(url.hostname)) {
    throw new Error(`E2E external network request blocked: ${url}`);
  }

  return originalFetch(input, init);
};
