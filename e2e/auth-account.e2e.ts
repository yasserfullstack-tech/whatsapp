import { createHmac, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  capturedEmailUrl,
  createTenant,
  destroyTenant,
  functionalSql,
  useTenantSession,
} from "./support/functional-helpers";
import { guardBrowser } from "./support/browser-guard";

function desktopOnly(projectName: string) {
  return projectName !== "desktop-1440";
}

async function cleanupAccountByEmail(email: string) {
  const rows = await functionalSql`
    SELECT au.id AS "authUserId", u.id AS "appUserId", om.organization_id AS "organizationId"
    FROM auth_user au
    LEFT JOIN users u ON u.external_auth_id = au.id
    LEFT JOIN organization_members om ON om.user_id = u.id
    WHERE au.email = ${email}
    LIMIT 1
  ` as unknown as Array<{ authUserId: string; appUserId: string | null; organizationId: string | null }>;
  const row = rows[0];
  if (!row) return;
  if (row.organizationId) await functionalSql`DELETE FROM organizations WHERE id = ${row.organizationId}`;
  if (row.appUserId) await functionalSql`DELETE FROM users WHERE id = ${row.appUserId}`;
  await functionalSql`DELETE FROM auth_user WHERE id = ${row.authUserId}`;
}

function decodeBase32(value: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = value.replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const char of normalized) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error(`Invalid base32 character ${char}`);
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  return Buffer.from(bytes);
}

function currentTotp(secret: string, timestamp = Date.now()) {
  const counter = Math.floor(timestamp / 30_000);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = ((digest[offset]! & 0x7f) << 24) | (digest[offset + 1]! << 16) | (digest[offset + 2]! << 8) | digest[offset + 3]!;
  return String(binary % 1_000_000).padStart(6, "0");
}

test.describe("authentication and account security workflows", () => {
  test.beforeEach(({}, testInfo) => test.skip(desktopOnly(testInfo.project.name), "deep auth workflows run once on desktop Chromium"));

  test("signup, verification, sign in, and sign out work end-to-end", async ({ page }) => {
    const health = await guardBrowser(page);
    const email = `browser-signup-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
    const password = `Browser-${randomUUID()}-Aa1!`;
    try {
      await page.goto("/sign-up");
      await page.getByLabel("Name").fill("Browser Signup E2E");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password").fill(password);
      await page.getByRole("button", { name: "Create account" }).click();
      await expect(page).toHaveURL(/\/verify-email\?email=/);

      await page.goto(await capturedEmailUrl(email, "Verify your email address"));
      await page.goto("/sign-in");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password").fill(password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page).toHaveURL(/\/dashboard$/);
      await expect(page.getByRole("heading", { name: "Browser Signup E2E's Workspace" })).toBeVisible();

      await page.getByRole("button", { name: /sign out/i }).click();
      await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
      await page.goto("/dashboard");
      await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
      await health.expectHealthy();
    } finally {
      await cleanupAccountByEmail(email);
    }
  });

  test("forgot password resets credentials and invalidates the old password", async ({ page, context }) => {
    const tenant = await createTenant("password-reset");
    try {
      await page.goto("/forgot-password");
      await page.getByLabel("Email").fill(tenant.email);
      await page.getByRole("button", { name: "Send reset link" }).click();
      await expect(page.getByRole("status")).toContainText("reset link");
      const resetUrl = await capturedEmailUrl(tenant.email, "Reset your password");
      await page.goto(resetUrl);

      const newPassword = `Reset-${randomUUID()}-Bb2!`;
      await page.getByLabel("New password", { exact: true }).fill(newPassword);
      await page.getByLabel("Confirm new password", { exact: true }).fill(`${newPassword}x`);
      await page.getByRole("button", { name: "Reset password" }).click();
      await expect(page.getByRole("alert")).toContainText("do not match");
      await page.getByLabel("Confirm new password", { exact: true }).fill(newPassword);
      await page.getByRole("button", { name: "Reset password" }).click();
      await expect(page).toHaveURL(/\/sign-in\?passwordReset=1/);

      await page.getByLabel("Email").fill(tenant.email);
      await page.getByLabel("Password").fill(tenant.password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page).not.toHaveURL(/\/dashboard$/);
      await page.getByLabel("Password").fill(newPassword);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page).toHaveURL(/\/dashboard$/);
      await context.clearCookies();
    } finally {
      await destroyTenant(tenant);
    }
  });

  test("TOTP enrollment is verified and required on the next sign in", async ({ page, context }) => {
    const tenant = await createTenant("mfa");
    try {
      await useTenantSession(context, tenant);
      await page.goto("/account/security");
      await page.getByRole("heading", { name: "TOTP + recovery codes" }).scrollIntoViewIfNeeded();
      await page.getByLabel("Current password").last().fill(tenant.password);
      const enableResponsePromise = page.waitForResponse((response) => response.url().includes("/two-factor/enable") && response.request().method() === "POST");
      await page.getByRole("button", { name: "Enable MFA" }).click();
      const enableResponse = await enableResponsePromise;
      expect(enableResponse.ok()).toBeTruthy();
      const payload = await enableResponse.json() as { totpURI?: string; data?: { totpURI?: string } };
      const totpURI = payload.totpURI ?? payload.data?.totpURI;
      expect(totpURI).toBeTruthy();
      const secret = new URL(totpURI!).searchParams.get("secret");
      expect(secret).toBeTruthy();

      await expect(page.getByLabel("Authenticator setup QR code")).toBeVisible();
      await page.getByLabel("6-digit authenticator code").fill(currentTotp(secret!));
      await page.getByRole("button", { name: "Verify and enable MFA" }).click();
      await expect(page.getByRole("status")).toContainText("MFA is enabled");

      await context.clearCookies();
      await page.goto("/sign-in");
      await page.getByLabel("Email").fill(tenant.email);
      await page.getByLabel("Password").fill(tenant.password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page).toHaveURL(/\/two-factor/);
      await page.getByLabel(/authenticator code/i).fill(currentTotp(secret!));
      await page.getByRole("button", { name: "Verify authenticator code" }).click();
      await expect(page).toHaveURL(/\/dashboard$/);
    } finally {
      await destroyTenant(tenant);
    }
  });
});
