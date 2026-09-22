import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import {
  BillingLimitExceededError,
  EntitlementService,
  type BillingEntitlementSnapshot,
  type BillingRepository,
  type BillingSubscriptionSnapshot,
  type EntitlementKey,
  type UsageAppendInput,
  type UsageAppendResult,
} from "@wa/billing";
import { createDatabase, schema } from "@wa/db";
import { reserveCampaignRecipientUsage } from "./campaign-billing";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for campaign billing tests");

class RecordingBillingRepository implements BillingRepository {
  readonly idempotency = new Set<string>();
  total = 0;

  constructor(private readonly limit: number | null) {}

  async getCurrentSubscription(organizationId: string, _at: Date): Promise<BillingSubscriptionSnapshot> {
    return {
      organizationId,
      subscriptionId: "subscription-test",
      planVersionId: "plan-version-test",
      planCode: "test",
      planName: "Test",
      status: "active",
      isManual: true,
      currentPeriodStart: new Date("2026-09-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-10-01T00:00:00.000Z"),
      trialEndsAt: null,
      graceEndsAt: null,
    };
  }

  async getEntitlement(_planVersionId: string, _key: EntitlementKey): Promise<BillingEntitlementSnapshot> {
    return { enabled: true, limit: this.limit };
  }

  async getUsage(): Promise<number> {
    return this.total;
  }

  async appendUsage(input: UsageAppendInput): Promise<UsageAppendResult> {
    const key = `${input.organizationId}:${input.idempotencyKey}`;
    if (this.idempotency.has(key)) return { recorded: false, total: this.total };

    const attemptedTotal = this.total + input.quantity;
    if (input.limit !== null && attemptedTotal > input.limit) {
      throw new BillingLimitExceededError(input.entitlementKey, input.limit, attemptedTotal);
    }

    this.idempotency.add(key);
    this.total = attemptedTotal;
    return { recorded: true, total: this.total };
  }
}

async function createCampaignFixture(db: ReturnType<typeof createDatabase>["db"], recipientCount: number) {
  const suffix = randomUUID();
  const [organization] = await db.insert(schema.organizations).values({
    name: `Campaign billing ${suffix}`,
    slug: `campaign-billing-${suffix}`,
  }).returning({ id: schema.organizations.id });
  if (!organization) throw new Error("Could not create organization fixture");

  const [phone] = await db.insert(schema.whatsappPhoneNumbers).values({
    organizationId: organization.id,
    wabaId: `waba-${suffix}`,
    phoneNumberId: `phone-${suffix}`,
    status: "connected",
    credentialKey: `credential-${suffix}`,
  }).returning({ id: schema.whatsappPhoneNumbers.id, wabaId: schema.whatsappPhoneNumbers.wabaId });
  if (!phone) throw new Error("Could not create phone fixture");

  const [template] = await db.insert(schema.templates).values({
    organizationId: organization.id,
    wabaId: phone.wabaId,
    metaTemplateId: `template-${suffix}`,
    name: `billing_${suffix.replaceAll("-", "").slice(0, 20)}`,
    language: "en",
    category: "marketing",
    status: "approved",
    components: [],
  }).returning({ id: schema.templates.id });
  if (!template) throw new Error("Could not create template fixture");

  const [campaign] = await db.insert(schema.campaigns).values({
    organizationId: organization.id,
    whatsappPhoneNumberId: phone.id,
    templateId: template.id,
    name: `Billing campaign ${suffix}`,
    status: "dispatching",
  }).returning({ id: schema.campaigns.id });
  if (!campaign) throw new Error("Could not create campaign fixture");

  const contacts = await db.insert(schema.contacts).values(
    Array.from({ length: recipientCount }, (_, index) => ({
      organizationId: organization.id,
      phoneE164: `+1555${suffix.replaceAll("-", "").slice(0, 5)}${String(index).padStart(4, "0")}`,
      optedIn: true,
    })),
  ).returning({ id: schema.contacts.id, phoneE164: schema.contacts.phoneE164 });

  await db.insert(schema.campaignRecipients).values(
    contacts.map((contact) => ({
      organizationId: organization.id,
      campaignId: campaign.id,
      contactId: contact.id,
      phoneE164: contact.phoneE164,
      status: "pending" as const,
    })),
  );

  return { organizationId: organization.id, campaignId: campaign.id };
}

describe("campaign recipient usage reservation", () => {
  test("reserves the immutable snapshot once across dispatch retries", async () => {
    const database = createDatabase(databaseUrl);
    const repository = new RecordingBillingRepository(null);
    const entitlements = new EntitlementService(repository);
    const fixture = await createCampaignFixture(database.db, 3);

    try {
      const first = await reserveCampaignRecipientUsage(database.db, entitlements, fixture);
      expect(first).toMatchObject({ reserved: true, recipients: 3, legacyMetered: 0, recorded: true });
      expect(repository.total).toBe(3);

      const retry = await reserveCampaignRecipientUsage(database.db, entitlements, fixture);
      expect(retry).toMatchObject({ reserved: true, recipients: 3, legacyMetered: 0, recorded: false });
      expect(repository.total).toBe(3);
    } finally {
      await database.db.delete(schema.organizations).where(eq(schema.organizations.id, fixture.organizationId));
      await database.client.end({ timeout: 5 });
    }
  });

  test("pauses the campaign before dispatch when the snapshot exceeds quota", async () => {
    const database = createDatabase(databaseUrl);
    const repository = new RecordingBillingRepository(2);
    const entitlements = new EntitlementService(repository);
    const fixture = await createCampaignFixture(database.db, 3);

    try {
      const result = await reserveCampaignRecipientUsage(database.db, entitlements, fixture);
      expect(result).toMatchObject({
        reserved: false,
        recipients: 3,
        legacyMetered: 0,
        reason: "billing_limit_exceeded",
      });
      expect(repository.total).toBe(0);

      const [campaign] = await database.db
        .select({ status: schema.campaigns.status })
        .from(schema.campaigns)
        .where(eq(schema.campaigns.id, fixture.campaignId))
        .limit(1);
      expect(campaign?.status).toBe("paused");
    } finally {
      await database.db.delete(schema.organizations).where(eq(schema.organizations.id, fixture.organizationId));
      await database.client.end({ timeout: 5 });
    }
  });
});
