const fakeBaseUrl = process.env.META_SEND_API_BASE_URL?.trim();

if (!fakeBaseUrl) {
  throw new Error("META_SEND_API_BASE_URL is required for the load-test worker preload");
}

const target = new URL(fakeBaseUrl);
if (!["localhost", "127.0.0.1", "::1", "fake-meta"].includes(target.hostname) && process.env.LOAD_ALLOW_REMOTE !== "1") {
  throw new Error("META_SEND_API_BASE_URL must point to a local fake service unless LOAD_ALLOW_REMOTE=1 is explicitly set");
}

const originalFetch = globalThis.fetch;

const redirectFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const originalUrl = input instanceof Request
    ? new URL(input.url)
    : input instanceof URL
      ? new URL(input.href)
      : new URL(input);

  const isWhatsAppSend = originalUrl.hostname === "graph.facebook.com" &&
    /^\/v\d+\.\d+\/[^/]+\/messages$/.test(originalUrl.pathname);

  if (!isWhatsAppSend) {
    return originalFetch(input, init);
  }

  const redirected = new URL(`${originalUrl.pathname}${originalUrl.search}`, target);
  if (input instanceof Request) {
    return originalFetch(new Request(redirected, input), init);
  }
  return originalFetch(redirected, init);
};

globalThis.fetch = Object.assign(redirectFetch, {
  preconnect: originalFetch.preconnect,
});
