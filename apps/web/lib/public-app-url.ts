const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function getPublicAppUrl(): URL {
  const configured = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? process.env.BETTER_AUTH_URL;
  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("APP_URL or NEXT_PUBLIC_APP_URL is required in production");
    }
    return new URL("http://localhost:3000");
  }

  const url = new URL(configured);
  if (process.env.NODE_ENV === "production" && LOCAL_HOSTNAMES.has(url.hostname.toLowerCase())) {
    throw new Error("The public application URL cannot use a loopback host in production");
  }
  return url;
}
