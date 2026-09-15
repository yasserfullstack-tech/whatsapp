const http = require("node:http");

const originalFetch = globalThis.fetch.bind(globalThis);
const fakeMetaBase = process.env.E2E_META_BASE_URL;
const blockExternal = process.env.E2E_BLOCK_EXTERNAL === "1";
const allowLocalStorageConnect = process.env.E2E_ALLOW_LOCAL_STORAGE_CONNECT === "1";
const localStorageOrigin = (() => {
  if (!allowLocalStorageConnect || !process.env.R2_ENDPOINT) return null;
  try {
    return new URL(process.env.R2_ENDPOINT).origin;
  } catch {
    return null;
  }
})();

function isLoopback(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function withLocalStorageConnect(value) {
  if (!localStorageOrigin || typeof value !== "string" || !value.includes("connect-src")) return value;
  return value.replace(/connect-src\s+([^;]+)/, (directive, sources) => {
    if (sources.split(/\s+/).includes(localStorageOrigin)) return directive;
    return `connect-src ${sources} ${localStorageOrigin}`;
  });
}

if (localStorageOrigin) {
  const originalSetHeader = http.ServerResponse.prototype.setHeader;
  http.ServerResponse.prototype.setHeader = function e2eSetHeader(name, value) {
    if (String(name).toLowerCase() === "content-security-policy") {
      value = Array.isArray(value) ? value.map(withLocalStorageConnect) : withLocalStorageConnect(value);
    }
    return originalSetHeader.call(this, name, value);
  };
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
