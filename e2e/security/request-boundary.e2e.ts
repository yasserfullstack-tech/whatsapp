import { expect, test } from "@playwright/test";

test.describe("request security boundary", () => {
  test("rejects cross-site mutation requests before authentication or input processing", async ({ request }) => {
    const response = await request.post("/api/audiences/segments", {
      headers: {
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
      },
      data: {},
    });
    expect(response.status()).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
  });

  test("same-origin anonymous mutation still reaches normal authentication", async ({ request }) => {
    const response = await request.post("/api/audiences/segments", {
      headers: {
        origin: "http://127.0.0.1:3000",
        "sec-fetch-site": "same-origin",
      },
      data: {},
    });
    expect(response.status()).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  test("production responses include browser hardening headers", async ({ request }) => {
    const response = await request.get("/sign-in");
    expect(response.status()).toBe(200);
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
    expect(response.headers()["x-frame-options"]).toBe("DENY");
    expect(response.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(response.headers()["permissions-policy"]).toContain("camera=()");
    expect(response.headers()["strict-transport-security"]).toContain("max-age=63072000");
    expect(response.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  });
});
