import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { schema, type createDatabase } from "@wa/db";

type Database = ReturnType<typeof createDatabase>["db"];

type CreateAppAuthInput = {
  db: Database;
  baseUrl: string;
  secret: string;
};

export function createAppAuth(input: CreateAppAuthInput) {
  return betterAuth({
    baseURL: input.baseUrl,
    secret: input.secret,
    database: drizzleAdapter(input.db, {
      provider: "pg",
      schema: {
        user: schema.authUser,
        session: schema.authSession,
        account: schema.authAccount,
        verification: schema.authVerification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
  });
}

export type AppAuth = ReturnType<typeof createAppAuth>;
