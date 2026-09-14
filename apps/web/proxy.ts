import { NextResponse, type NextRequest } from "next/server";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const SESSION_COOKIE = /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=/;

function configuredOrigins(): Set<string> {
  const origins = new Set<string>();
  for (const value of [process.env.APP_URL, process.env.BETTER_AUTH_URL]) {
    if (!value) continue;
    try {
      origins.add(new URL(value).origin);
    } catch {
      // Invalid deployment configuration is handled by the application env loader.
    }
  }
  return origins;
}

function hasSessionCookie(request: NextRequest): boolean {
  return SESSION_COOKIE.test(request.headers.get("cookie") ?? "");
}

export function proxy(request: NextRequest) {
  if (SAFE_METHODS.has(request.method)) return NextResponse.next();

  // Better Auth owns its own origin/trusted-origin checks. This proxy protects the
  // application's cookie-authenticated mutation APIs without changing auth flows.
  if (request.nextUrl.pathname.startsWith("/api/auth/")) return NextResponse.next();

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const origin = request.headers.get("origin");
  if (!origin && hasSessionCookie(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (origin) {
    const allowed = configuredOrigins();
    // Local development remains usable when APP_URL is omitted, while production
    // normally has BETTER_AUTH_URL and/or APP_URL configured explicitly.
    if (allowed.size === 0) allowed.add(request.nextUrl.origin);
    if (!allowed.has(origin)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
