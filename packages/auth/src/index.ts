import { betterAuth, type SecondaryStorage } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { schema, type createDatabase } from "@wa/db";

type Database = ReturnType<typeof createDatabase>["db"];

export type AuthEmailMessage = {
  to: string;
  subject: string;
  text: string;
};

type CreateAppAuthInput = {
  db: Database;
  baseUrl: string;
  secret: string;
  trustedOrigins?: string[];
  secureCookies?: boolean;
  secondaryStorage?: SecondaryStorage;
  sendEmail: (message: AuthEmailMessage) => Promise<void>;
};

function dispatchEmail(input: CreateAppAuthInput, message: AuthEmailMessage) {
  void input.sendEmail(message).catch((error) => {
    console.error("Failed to send authentication email", error);
  });
}

export function createAppAuth(input: CreateAppAuthInput) {
  const secureCookies = input.secureCookies ?? false;

  return betterAuth({
    appName: "WhatsApp Campaigns",
    baseURL: input.baseUrl,
    secret: input.secret,
    trustedOrigins: input.trustedOrigins,
    secondaryStorage: input.secondaryStorage,
    database: drizzleAdapter(input.db, {
      provider: "pg",
      schema: {
        user: schema.authUser,
        session: schema.authSession,
        account: schema.authAccount,
        verification: schema.authVerification,
      },
    }),
    advanced: {
      useSecureCookies: secureCookies,
      disableCSRFCheck: false,
      disableOriginCheck: false,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: secureCookies,
      },
    },
    verification: {
      storeIdentifier: "hashed",
    },
    emailVerification: {
      expiresIn: 60 * 60,
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) => {
        dispatchEmail(input, {
          to: user.email,
          subject: "Verify your email address",
          text: `Verify your email address to finish setting up your WhatsApp Campaigns account:\n\n${url}\n\nThis link expires in 60 minutes. If you did not request this, you can ignore this email.`,
        });
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 60 * 30,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        dispatchEmail(input, {
          to: user.email,
          subject: "Reset your password",
          text: `A password reset was requested for your WhatsApp Campaigns account.\n\n${url}\n\nThis link expires in 30 minutes. If you did not request this, you can ignore this email.`,
        });
      },
    },
    user: {
      changeEmail: {
        enabled: true,
        updateEmailWithoutVerification: false,
        sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
          dispatchEmail(input, {
            to: user.email,
            subject: "Approve your email address change",
            text: `A request was made to change your account email from ${user.email} to ${newEmail}.\n\nApprove the change here:\n${url}\n\nIf you did not request this, do not approve the change and review your active sessions.`,
          });
        },
      },
    },
    rateLimit: {
      enabled: true,
      storage: input.secondaryStorage ? "secondary-storage" : "memory",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60 * 10, max: 5 },
        "/request-password-reset": { window: 60 * 15, max: 3 },
        "/reset-password": { window: 60 * 15, max: 5 },
        "/send-verification-email": { window: 60 * 15, max: 3 },
        "/change-email": { window: 60 * 15, max: 3 },
        "/change-password": { window: 60 * 15, max: 5 },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      freshAge: 60 * 10,
      storeSessionInDatabase: true,
    },
  });
}

export type AppAuth = ReturnType<typeof createAppAuth>;
