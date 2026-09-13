import { randomUUID } from "node:crypto";
import { expect, request, test } from "@playwright/test";

const protectedPath = `/api/campaigns/${randomUUID()}`;

const invalidCookies = [
  "better-auth.session_token=not-a-valid-session-token",
  "better-auth.session_token=abc.def.ghi",
  "better-auth.session_token=00000000-0000-0000-0000-000000000000",
];

test.describe("bad session handling", () => {
  for (const cookie of invalidCookies) {
    test(`rejects malformed or unknown session token: ${cookie.slice(0, 36)}`, async () => {
      const api = await request.newContext({
        baseURL: "http://127.0.0.1:3000",
        extraHTTPHeaders: { cookie },
      });

      try {
        const response = await api.get(protectedPath);
        expect(response.status()).toBe(401);
        expect(await response.json()).toEqual({ error: "Unauthorized" });
      } finally {
        await api.dispose();
      }
    });
  }
});
