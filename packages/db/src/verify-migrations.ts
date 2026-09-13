import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const expectedPublicTables = [
  "auth_account",
  "auth_session",
  "auth_two_factor",
  "auth_user",
  "auth_verification",
  "audience_segments",
  "billing_accounts",
  "billing_period_usage",
  "billing_provider_events",
  "campaign_audiences",
  "campaign_recipients",
  "campaigns",
  "contact_consent_events",
  "contact_imports",
  "contact_list_members",
  "contact_lists",
  "contacts",
  "credential_secrets",
  "invoices",
  "notification_deliveries",
  "notification_preferences",
  "notifications",
  "organization_admin_settings",
  "organization_invitations",
  "organization_members",
  "organization_onboarding",
  "organizations",
  "payments",
  "plan_entitlements",
  "plan_versions",
  "plans",
  "platform_admin_grants",
  "platform_audit_events",
  "platform_user_controls",
  "subscription_changes",
  "subscriptions",
  "suppression_list",
  "templates",
  "usage_ledger",
  "users",
  "webhook_events",
  "whatsapp_phone_numbers",
  "workspace_audit_logs",
  "workspace_preferences",
] as const;

const sql = postgres(databaseUrl, { max: 1, idle_timeout: 5, connect_timeout: 10 });

try {
  const tables = await sql<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
  `;
  const existing = new Set(tables.map((row) => row.table_name));
  const missing = expectedPublicTables.filter((table) => !existing.has(table));
  if (missing.length) {
    throw new Error(`Migration smoke check is missing tables: ${missing.join(", ")}`);
  }

  const migrationTable = await sql<{ relation: string | null }[]>`
    SELECT to_regclass('drizzle.__drizzle_migrations')::text AS relation
  `;
  if (!migrationTable[0]?.relation) {
    throw new Error("Drizzle migration log table was not created");
  }

  const migrationRows = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations
  `;
  if ((migrationRows[0]?.count ?? 0) < 9) {
    throw new Error("Expected all nine committed migrations in drizzle.__drizzle_migrations");
  }

  console.log("Migration smoke check passed", {
    tables: expectedPublicTables.length,
    appliedMigrations: migrationRows[0]?.count ?? 0,
  });
} finally {
  await sql.end();
}
