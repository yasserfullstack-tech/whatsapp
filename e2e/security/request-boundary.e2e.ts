import { expect, request, test } from "@playwright/test";
import {
  SECURITY_BASE_URL,
  createSecurityTenant,
  destroySecurityTenant,
  type SecurityTenant,
} from "./security-helpers";

test.describe.serial("request security boundary", () => {
  let tenant: SecurityTenant;

  test.beforeAll(async () => {
    tenant = await createSecurityTenant("request-boundary");
  });

  test.afterAll(async () => {
    if (tenant) await destroySecurityTenant(tenant);
  });

  test("rejects cross-site mutation requests before authentication or input processing", async ({ request: anonymous }) => {
    const response = await anonymous.post("/api/audiences/segments", {
      headers: {
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
      },
      data: {},
    });
    expect(response.status()).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
  });

  test("same-origin anonymous mutation still reaches normal authentication", async ({ request: anonymous }) => {
    const response = await anonymous.post("/api/audiences/segments", {
      headers: {
        origin: SECURITY_BASE_URL,
        "sec-fetch-site": "same-origin",
      },
      data: {},
    });
    expect(response.status()).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  test("authenticated cookie mutations require an explicit trusted Origin", async () => {
    const missingOrigin = await request.newContext({
      baseURL: SECURITY_BASE_URL,
      extraHTTPHeaders: { cookie: tenant.cookie },
    });
    try {
      const response = await missingOrigin.post("/api/audiences/segments", { data: {} });
      expect(response.status()).toBe(403);
      expect(await response.json()).toEqual({ error: "Forbidden" });
    } finally {
      await missingOrigin.dispose();
    }
  });

  test("null and spoofed origins cannot authorize authenticated mutations", async () => {
    for (const origin of ["null", "https://attacker.example", "http://127.0.0.1:3000.attacker.example"]) {
      const api = await request.newContext({
        baseURL: SECURITY_BASE_URL,
        extraHTTPHeaders: {
          cookie: tenant.cookie,
          origin,
          "sec-fetch-site": "same-site",
        },
      });
      try {
        const response = await api.post("/api/audiences/segments", { data: {} });
        expect(response.status(), `origin ${origin} must be rejected`).toBe(403);
      } finally {
        await api.dispose();
      }
    }
  });

  test("production responses include browser hardening headers", async ({ request: anonymous }) => {
    const response = await anonymous.get("/sign-in");
    expect(response.status()).toBe(200);
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
    expect(response.headers()["x-frame-options"]).toBe("DENY");
    expect(response.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(response.headers()["permissions-policy"]).toContain("camera=()");
    expect(response.headers()["strict-transport-security"]).toContain("max-age=63072000");
    expect(response.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  });
});
