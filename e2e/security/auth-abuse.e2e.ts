import { randomUUID } from "node:crypto";
import { expect, request, test } from "@playwright/test";
import {
  SECURITY_BASE_URL,
  createSecurityTenant,
  destroySecurityTenant,
  type SecurityTenant,
} from "./security-helpers";

function safeBody(text: string) {
  expect(text.toLowerCase()).not.toContain("stack trace");
  expect(text).not.toContain("node_modules/");
  expect(text).not.toContain("postgres://");
  expect(text).not.toContain("BETTER_AUTH_SECRET");
}

test.describe.serial("authentication abuse boundaries", () => {
  let tenant: SecurityTenant;

  test.beforeAll(async () => {
    tenant = await createSecurityTenant("auth-abuse");
  });

  test.afterAll(async () => {
    if (tenant) await destroySecurityTenant(tenant);
  });

  test("Better Auth rejects cross-site credential login requests", async () => {
    const api = await request.newContext({ baseURL: SECURITY_BASE_URL });
    try {
      const response = await api.post("/api/auth/sign-in/email", {
        headers: {
          origin: "https://attacker.example",
          "sec-fetch-site": "cross-site",
        },
        data: { email: tenant.email, password: tenant.password },
      });
      expect([400, 403]).toContain(response.status());
      safeBody(await response.text());
    } finally {
      await api.dispose();
    }
  });

  test("wrong-password and unknown-user login errors do not enumerate accounts", async () => {
    const api = await request.newContext({ baseURL: SECURITY_BASE_URL });
    try {
      const headers = { origin: SECURITY_BASE_URL, "sec-fetch-site": "same-origin" };
      const existing = await api.post("/api/auth/sign-in/email", {
        headers,
        data: { email: tenant.email, password: `Wrong-${randomUUID()}` },
      });
      const unknown = await api.post("/api/auth/sign-in/email", {
        headers,
        data: { email: `unknown-${randomUUID()}@example.test`, password: `Wrong-${randomUUID()}` },
      });
      expect(existing.status()).toBe(unknown.status());
      const existingBody = await existing.text();
      const unknownBody = await unknown.text();
      expect(existingBody).toBe(unknownBody);
      expect(existingBody.toLowerCase()).not.toContain(tenant.email.toLowerCase());
      safeBody(existingBody);
    } finally {
      await api.dispose();
    }
  });

  test("password-reset responses do not enumerate accounts and the endpoint throttles abuse", async () => {
    const api = await request.newContext({ baseURL: SECURITY_BASE_URL });
    try {
      const headers = { origin: SECURITY_BASE_URL, "sec-fetch-site": "same-origin" };
      const existing = await api.post("/api/auth/request-password-reset", {
        headers,
        data: { email: tenant.email, redirectTo: "/reset-password" },
      });
      const unknownEmail = `unknown-reset-${randomUUID()}@example.test`;
      const unknown = await api.post("/api/auth/request-password-reset", {
        headers,
        data: { email: unknownEmail, redirectTo: "/reset-password" },
      });
      expect(existing.status()).toBe(unknown.status());
      expect(existing.status()).toBe(200);
      const existingBody = await existing.text();
      const unknownBody = await unknown.text();
      expect(existingBody).toBe(unknownBody);
      expect(existingBody.toLowerCase()).not.toContain(tenant.email.toLowerCase());
      safeBody(existingBody);

      const third = await api.post("/api/auth/request-password-reset", {
        headers,
        data: { email: `third-${randomUUID()}@example.test`, redirectTo: "/reset-password" },
      });
      expect(third.status()).toBe(200);

      const throttled = await api.post("/api/auth/request-password-reset", {
        headers,
        data: { email: `fourth-${randomUUID()}@example.test`, redirectTo: "/reset-password" },
      });
      expect(throttled.status()).toBe(429);
      expect(Number(throttled.headers()["x-retry-after"] ?? "0")).toBeGreaterThan(0);
      safeBody(await throttled.text());
    } finally {
      await api.dispose();
    }
  });

  test("untrusted callback and reset URLs are rejected instead of becoming dangerous redirects", async () => {
    const api = await request.newContext({ baseURL: SECURITY_BASE_URL });
    try {
      const headers = { origin: SECURITY_BASE_URL, "sec-fetch-site": "same-origin" };
      const signIn = await api.post("/api/auth/sign-in/email", {
        headers,
        data: {
          email: tenant.email,
          password: `Wrong-${randomUUID()}`,
          callbackURL: "javascript:alert(document.domain)",
        },
        maxRedirects: 0,
      });
      expect(signIn.headers().location ?? "").not.toMatch(/^javascript:/i);
      safeBody(await signIn.text());

      const reset = await api.post("/api/auth/request-password-reset", {
        headers,
        data: {
          email: `url-check-${randomUUID()}@example.test`,
          redirectTo: "https://attacker.example/reset",
        },
        maxRedirects: 0,
      });
      expect([400, 403, 429]).toContain(reset.status());
      expect(reset.headers().location ?? "").not.toContain("attacker.example");
      safeBody(await reset.text());
    } finally {
      await api.dispose();
    }
  });

  test("auth route rejects oversized request bodies without leaking internals", async () => {
    const api = await request.newContext({ baseURL: SECURITY_BASE_URL });
    try {
      const response = await api.post("/api/auth/sign-in/email", {
        headers: {
          origin: SECURITY_BASE_URL,
          "sec-fetch-site": "same-origin",
          "content-type": "application/json",
        },
        data: JSON.stringify({
          email: `oversized-${randomUUID()}@example.test`,
          password: "x".repeat(70 * 1024),
        }),
      });
      expect(response.status()).toBe(413);
      expect(await response.json()).toEqual({ error: "Request body too large" });
    } finally {
      await api.dispose();
    }
  });
});
