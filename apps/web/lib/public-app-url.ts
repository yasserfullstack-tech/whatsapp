function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost"
    || normalized.endsWith(".localhost")
    || normalized === "127.0.0.1"
    || normalized === "::1"
    || normalized === "[::1]";
}

export function getPublicAppUrl(): URL {
  const configured = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? process.env.BETTER_AUTH_URL;
  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("APP_URL or NEXT_PUBLIC_APP_URL is required in production");
    }
    return new URL("http://localhost:3000");
  }

  const url = new URL(configured);
  if (process.env.NODE_ENV === "production" && isLoopbackHostname(url.hostname)) {
    throw new Error("The public application URL cannot use a loopback host in production");
  }
  return url;
}
