import { NextResponse, type NextRequest } from "next/server";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const SESSION_COOKIE = /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=/;
const isProduction = process.env.NODE_ENV === "production";

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

function optionalOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function hasSessionCookie(request: NextRequest): boolean {
  return SESSION_COOKIE.test(request.headers.get("cookie") ?? "");
}

function contentSecurityPolicy(nonce: string): string {
  const r2Origin = optionalOrigin(process.env.R2_ENDPOINT);
  const connectSources = [
    "'self'",
    "https://graph.facebook.com",
    "https://www.facebook.com",
    "https://web.facebook.com",
    "https://*.r2.cloudflarestorage.com",
    ...(r2Origin ? [r2Origin] : []),
  ];

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://connect.facebook.net`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${connectSources.join(" ")}`,
    "frame-src https://www.facebook.com https://web.facebook.com",
    "upgrade-insecure-requests",
  ].join("; ");
}

function continueRequest(request: NextRequest): NextResponse {
  if (!isProduction) return NextResponse.next();

  const nonce = crypto.randomUUID().replaceAll("-", "");
  const csp = contentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  // Next.js reads the request CSP header to discover the nonce and applies it
  // to framework/script tags during dynamic rendering.
  requestHeaders.set("Content-Security-Policy", csp);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export function proxy(request: NextRequest) {
  const isApiRequest = request.nextUrl.pathname.startsWith("/api/");
  if (!isApiRequest || SAFE_METHODS.has(request.method)) return continueRequest(request);

  // Better Auth owns its own origin/trusted-origin checks. This proxy protects the
  // application's cookie-authenticated mutation APIs without changing auth flows.
  if (request.nextUrl.pathname.startsWith("/api/auth/")) return continueRequest(request);

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

  return continueRequest(request);
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
