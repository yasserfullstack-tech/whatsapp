import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const memberRole = pgEnum("member_role", ["owner", "admin", "member", "viewer"]);
export const connectionStatus = pgEnum("connection_status", ["pending", "connected", "restricted", "disconnected"]);
export const templateCategory = pgEnum("template_category", ["marketing", "utility", "authentication"]);
export const templateStatus = pgEnum("template_status", ["draft", "pending", "approved", "rejected", "paused", "disabled"]);
export const campaignStatus = pgEnum("campaign_status", ["draft", "scheduled", "dispatching", "sending", "paused", "completed", "cancelled", "failed"]);
export const recipientStatus = pgEnum("recipient_status", ["pending", "queued", "sent", "delivered", "read", "failed", "skipped"]);

// Better Auth core tables. They intentionally use an auth_ prefix so application users
// can keep a stable internal UUID independent of the authentication provider/runtime.
export const authUser = pgTable("auth_user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt,
  updatedAt,
});

export const authSession = pgTable(
  "auth_session",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => authUser.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt,
    updatedAt,
  },
  (table) => [index("auth_session_user_idx").on(table.userId)],
);

export const authAccount = pgTable(
  "auth_account",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => authUser.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    idToken: text("id_token"),
    password: text("password"),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("auth_account_user_idx").on(table.userId),
    uniqueIndex("auth_account_provider_account_uq").on(table.providerId, table.accountId),
  ],
);

export const authVerification = pgTable(
  "auth_verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [index("auth_verification_identifier_idx").on(table.identifier)],
);

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt,
  updatedAt,
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  externalAuthId: text("external_auth_id").notNull().unique(),
  email: text("email").notNull(),
  displayName: text("display_name"),
  createdAt,
  updatedAt,
});

export const organizationMembers = pgTable(
  "organization_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: memberRole("role").notNull().default("member"),
    createdAt,
  },
  (table) => [uniqueIndex("organization_members_org_user_uq").on(table.organizationId, table.userId)],
);

export const credentialSecrets = pgTable(
  "credential_secrets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    key: text("key").notNull().unique(),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    authTag: text("auth_tag").notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [index("credential_secrets_org_idx").on(table.organizationId)],
);

export const whatsappPhoneNumbers = pgTable(
  "whatsapp_phone_numbers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    metaBusinessId: text("meta_business_id"),
    wabaId: text("waba_id").notNull(),
    phoneNumberId: text("phone_number_id").notNull(),
    displayPhoneNumber: text("display_phone_number"),
    verifiedName: text("verified_name"),
    status: connectionStatus("status").notNull().default("pending"),
    qualityRating: text("quality_rating"),
    throughputMps: integer("throughput_mps").notNull().default(80),
    credentialKey: text("credential_key").notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("whatsapp_phone_numbers_phone_id_uq").on(table.phoneNumberId),
    index("whatsapp_phone_numbers_org_idx").on(table.organizationId),
  ],
);

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    phoneE164: text("phone_e164").notNull(),
    displayName: text("display_name"),
    optedIn: boolean("opted_in").notNull().default(false),
    optInSource: text("opt_in_source"),
    optInAt: timestamp("opt_in_at", { withTimezone: true }),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("contacts_org_phone_uq").on(table.organizationId, table.phoneE164),
    index("contacts_org_opt_in_idx").on(table.organizationId, table.optedIn),
  ],
);

export const templates = pgTable(
  "templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    metaTemplateId: text("meta_template_id"),
    name: text("name").notNull(),
    language: text("language").notNull().default("en"),
    category: templateCategory("category").notNull(),
    status: templateStatus("status").notNull().default("draft"),
    bodyPreview: text("body_preview"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("templates_org_name_language_uq").on(table.organizationId, table.name, table.language),
    index("templates_org_status_idx").on(table.organizationId, table.status),
  ],
);

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    whatsappPhoneNumberId: uuid("whatsapp_phone_number_id").notNull().references(() => whatsappPhoneNumbers.id),
    templateId: uuid("template_id").notNull().references(() => templates.id),
    name: text("name").notNull(),
    status: campaignStatus("status").notNull().default("draft"),
    recipientCount: integer("recipient_count").notNull().default(0),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [index("campaigns_org_status_idx").on(table.organizationId, table.status)],
);

export const campaignRecipients = pgTable(
  "campaign_recipients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull().references(() => contacts.id),
    phoneE164: text("phone_e164").notNull(),
    status: recipientStatus("status").notNull().default("pending"),
    wamid: text("wamid"),
    errorCode: text("error_code"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    createdAt,
  },
  (table) => [
    uniqueIndex("campaign_recipients_campaign_contact_uq").on(table.campaignId, table.contactId),
    index("campaign_recipients_dispatch_idx").on(table.campaignId, table.status, table.id),
    index("campaign_recipients_wamid_idx").on(table.wamid),
  ],
);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    phoneNumberId: text("phone_number_id"),
    eventKey: text("event_key").notNull(),
    payload: jsonb("payload").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt,
  },
  (table) => [
    uniqueIndex("webhook_events_event_key_uq").on(table.eventKey),
    index("webhook_events_unprocessed_idx").on(table.processedAt),
  ],
);
