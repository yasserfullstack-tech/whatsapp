import { createHmac } from "node:crypto";
import { expect, request, test, type APIResponse } from "@playwright/test";
import {
  SECURITY_BASE_URL,
  createSecurityTenant,
  destroySecurityTenant,
  securitySql,
  type SecurityTenant,
} from "./security-helpers";

function responseCookies(response: APIResponse): string[] {
  return response.headersArray()
    .filter(({ name }) => name.toLowerCase() === "set-cookie")
    .map(({ value }) => value.split(";", 1)[0])
    .filter(Boolean);
}

function mergeCookieHeaders(...headers: Array<string | string[]>): string {
  const pairs = headers.flatMap((header) => Array.isArray(header) ? header : header.split(/;\s*/));
  const byName = new Map<string, string>();
  for (const pair of pairs) {
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    byName.set(pair.slice(0, separator), pair);
  }
  return [...byName.values()].join("; ");
}

function decodeBase32(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = input.toUpperCase().replace(/=+$/g, "");
  let bits = "";
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid base32 TOTP secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

function totpCode(secret: string, at = Date.now()): string {
  const counter = BigInt(Math.floor(at / 30_000));
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(counter);
  const digest = createHmac("sha1", decodeBase32(secret)).update(buffer).digest();
  const offset = (digest.at(-1) ?? 0) & 0x0f;
  const binary = ((digest[offset] ?? 0) & 0x7f) << 24
    | ((digest[offset + 1] ?? 0) & 0xff) << 16
    | ((digest[offset + 2] ?? 0) & 0xff) << 8
    | ((digest[offset + 3] ?? 0) & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

async function signInForMfa(tenant: SecurityTenant) {
  const api = await request.newContext({ baseURL: SECURITY_BASE_URL });
  const response = await api.post("/api/auth/sign-in/email", {
    headers: { origin: SECURITY_BASE_URL, "sec-fetch-site": "same-origin" },
    data: { email: tenant.email, password: tenant.password },
  });
  const body = await response.json() as { twoFactorRedirect?: boolean; twoFactorMethods?: string[] };
  expect(response.ok(), JSON.stringify(body)).toBeTruthy();
  expect(body.twoFactorRedirect).toBe(true);
  expect(body.twoFactorMethods).toContain("totp");
  const cookies = responseCookies(response);
  expect(cookies.some((cookie) => cookie.includes("two_factor"))).toBe(true);
  await api.dispose();
  return mergeCookieHeaders(cookies);
}

test.describe.serial("MFA security", () => {
  let tenant: SecurityTenant;
  let backupCode: string;

  test.beforeAll(async () => {
    tenant = await createSecurityTenant("mfa");
  });

  test.afterAll(async () => {
    if (tenant) await destroySecurityTenant(tenant);
  });

  test("TOTP enrollment requires proof and enabled MFA blocks password-only sign-in", async () => {
    const enrollmentApi = await request.newContext({
      baseURL: SECURITY_BASE_URL,
      extraHTTPHeaders: {
        cookie: tenant.cookie,
        origin: SECURITY_BASE_URL,
        "sec-fetch-site": "same-origin",
      },
    });
    try {
      const enable = await enrollmentApi.post("/api/auth/two-factor/enable", {
        data: { password: tenant.password, method: "totp", issuer: "WhatsApp Campaigns" },
      });
      expect(enable.ok(), await enable.text()).toBeTruthy();
      const enrollment = await enable.json() as { method?: string; totpURI?: string; backupCodes?: string[] };
      expect(enrollment.method).toBe("totp");
      expect(enrollment.totpURI).toBeTruthy();
      expect(enrollment.backupCodes?.length).toBeGreaterThan(0);
      backupCode = enrollment.backupCodes?.[0] ?? "";
      if (!enrollment.totpURI || !backupCode) throw new Error("MFA enrollment did not return TOTP/recovery material");

      const beforeVerify = await securitySql`
        SELECT two_factor_enabled AS "enabled"
        FROM auth_user
        WHERE id = ${tenant.authUserId}
      ` as unknown as Array<{ enabled: boolean }>;
      expect(beforeVerify[0]?.enabled).toBe(false);

      const uri = new URL(enrollment.totpURI);
      const secret = uri.searchParams.get("secret");
      if (!secret) throw new Error("TOTP URI did not contain a secret");

      const verifyApi = await request.newContext({
        baseURL: SECURITY_BASE_URL,
        extraHTTPHeaders: {
          cookie: mergeCookieHeaders(tenant.cookie, responseCookies(enable)),
          origin: SECURITY_BASE_URL,
          "sec-fetch-site": "same-origin",
        },
      });
      try {
        const verify = await verifyApi.post("/api/auth/two-factor/verify-totp", {
          data: { code: totpCode(secret), trustDevice: false },
        });
        expect(verify.ok(), await verify.text()).toBeTruthy();
      } finally {
        await verifyApi.dispose();
      }
    } finally {
      await enrollmentApi.dispose();
    }

    const afterVerify = await securitySql`
      SELECT two_factor_enabled AS "enabled"
      FROM auth_user
      WHERE id = ${tenant.authUserId}
    ` as unknown as Array<{ enabled: boolean }>;
    expect(afterVerify[0]?.enabled).toBe(true);

    const challengeCookie = await signInForMfa(tenant);
    const challenged = await request.newContext({
      baseURL: SECURITY_BASE_URL,
      extraHTTPHeaders: { cookie: challengeCookie },
    });
    try {
      const protectedResponse = await challenged.get("/api/settings/data/export");
      expect(protectedResponse.status()).toBe(401);
    } finally {
      await challenged.dispose();
    }
  });

  test("recovery codes are single-use and cannot be replayed", async () => {
    const challengeCookie = await signInForMfa(tenant);
    const challenge = await request.newContext({
      baseURL: SECURITY_BASE_URL,
      extraHTTPHeaders: {
        cookie: challengeCookie,
        origin: SECURITY_BASE_URL,
        "sec-fetch-site": "same-origin",
      },
    });
    let sessionCookie = "";
    try {
      const verify = await challenge.post("/api/auth/two-factor/verify-backup-code", {
        data: { code: backupCode, disableSession: false, trustDevice: false },
      });
      expect(verify.ok(), await verify.text()).toBeTruthy();
      sessionCookie = mergeCookieHeaders(responseCookies(verify));
      expect(sessionCookie).toContain("session_token=");
    } finally {
      await challenge.dispose();
    }

    const authenticated = await request.newContext({
      baseURL: SECURITY_BASE_URL,
      extraHTTPHeaders: { cookie: sessionCookie },
    });
    try {
      expect((await authenticated.get("/api/settings/data/export")).status()).toBe(200);
    } finally {
      await authenticated.dispose();
    }

    const replayChallengeCookie = await signInForMfa(tenant);
    const replay = await request.newContext({
      baseURL: SECURITY_BASE_URL,
      extraHTTPHeaders: {
        cookie: replayChallengeCookie,
        origin: SECURITY_BASE_URL,
        "sec-fetch-site": "same-origin",
      },
    });
    try {
      const replayResponse = await replay.post("/api/auth/two-factor/verify-backup-code", {
        data: { code: backupCode, disableSession: false, trustDevice: false },
      });
      expect(replayResponse.ok()).toBe(false);
      const protectedResponse = await replay.get("/api/settings/data/export");
      expect(protectedResponse.status()).toBe(401);
    } finally {
      await replay.dispose();
    }
  });
});
