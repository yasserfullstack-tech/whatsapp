import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { createDatabase, schema } from "@wa/db";
import { processInboxWebhookEvent } from "./inbox";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for inbox integration tests");

function inboundPayload(input: {
  phoneNumberId: string;
  wabaId: string;
  wamid: string;
  from?: string;
  body?: string;
}) {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: input.wabaId,
      changes: [{
        field: "messages",
        value: {
          metadata: { phone_number_id: input.phoneNumberId, display_phone_number: "+15550001000" },
          contacts: [{ wa_id: input.from ?? "15550009999", profile: { name: "Inbox customer" } }],
          messages: [{
            id: input.wamid,
            from: input.from ?? "15550009999",
            timestamp: "1789590000",
            type: "text",
            text: { body: input.body ?? "Hello inbox" },
          }],
        },
      }],
    }],
  };
}

describe("inbox durable projection", () => {
  test("webhook replay does not duplicate a message or unread increment", async () => {
    const database = createDatabase(databaseUrl);
    const db = database.db;
    const suffix = randomUUID();
    const [organization] = await db.insert(schema.organizations).values({
      name: `Inbox replay ${suffix}`,
      slug: `inbox-replay-${suffix}`,
    }).returning({ id: schema.organizations.id });
    if (!organization) throw new Error("Could not create organization fixture");

    try {
      const [phone] = await db.insert(schema.whatsappPhoneNumbers).values({
        organizationId: organization.id,
        wabaId: `waba-${suffix}`,
        phoneNumberId: `phone-${suffix}`,
        status: "connected",
        credentialKey: `org/${organization.id}/whatsapp/phone-${suffix}/access-token`,
      }).returning({ id: schema.whatsappPhoneNumbers.id });
      if (!phone) throw new Error("Could not create phone fixture");

      const payload = inboundPayload({
        phoneNumberId: `phone-${suffix}`,
        wabaId: `waba-${suffix}`,
        wamid: `wamid.replay.${suffix}`,
      });
      const events = await db.insert(schema.webhookEvents).values([
        {
          organizationId: organization.id,
          phoneNumberId: `phone-${suffix}`,
          eventKey: `inbox-replay-a-${suffix}`,
          payload,
          processingStatus: "processed",
          processedAt: new Date(),
        },
        {
          organizationId: organization.id,
          phoneNumberId: `phone-${suffix}`,
          eventKey: `inbox-replay-b-${suffix}`,
          payload,
          processingStatus: "processed",
          processedAt: new Date(),
        },
      ]).returning({ id: schema.webhookEvents.id, payload: schema.webhookEvents.payload });
      const [first, replay] = events;
      if (!first || !replay) throw new Error("Could not create webhook fixtures");

      const firstResult = await processInboxWebhookEvent(db, first);
      const replayResult = await processInboxWebhookEvent(db, replay);
      expect(firstResult.messages).toBe(1);
      expect(replayResult.messages).toBe(0);

      const messages = await db.select({ id: schema.inboxMessages.id })
        .from(schema.inboxMessages)
        .where(and(
          eq(schema.inboxMessages.organizationId, organization.id),
          eq(schema.inboxMessages.wamid, `wamid.replay.${suffix}`),
        ));
      expect(messages).toHaveLength(1);

      const conversations = await db.select({ unreadCount: schema.inboxConversations.unreadCount })
        .from(schema.inboxConversations)
        .where(eq(schema.inboxConversations.organizationId, organization.id));
      expect(conversations).toEqual([{ unreadCount: 1 }]);
    } finally {
      await db.delete(schema.organizations).where(eq(schema.organizations.id, organization.id));
      await database.client.end({ timeout: 5 });
    }
  });

  test("phone ownership keeps otherwise identical inbound traffic tenant-isolated", async () => {
    const database = createDatabase(databaseUrl);
    const db = database.db;
    const suffix = randomUUID();
    const organizations = await db.insert(schema.organizations).values([
      { name: `Inbox alpha ${suffix}`, slug: `inbox-alpha-${suffix}` },
      { name: `Inbox beta ${suffix}`, slug: `inbox-beta-${suffix}` },
    ]).returning({ id: schema.organizations.id });
    const [alpha, beta] = organizations;
    if (!alpha || !beta) throw new Error("Could not create organization fixtures");

    try {
      await db.insert(schema.whatsappPhoneNumbers).values([
        {
          organizationId: alpha.id,
          wabaId: `waba-alpha-${suffix}`,
          phoneNumberId: `phone-alpha-${suffix}`,
          status: "connected",
          credentialKey: `org/${alpha.id}/whatsapp/phone-alpha-${suffix}/access-token`,
        },
        {
          organizationId: beta.id,
          wabaId: `waba-beta-${suffix}`,
          phoneNumberId: `phone-beta-${suffix}`,
          status: "connected",
          credentialKey: `org/${beta.id}/whatsapp/phone-beta-${suffix}/access-token`,
        },
      ]);

      const alphaPayload = inboundPayload({
        phoneNumberId: `phone-alpha-${suffix}`,
        wabaId: `waba-alpha-${suffix}`,
        wamid: `wamid.alpha.${suffix}`,
      });
      const betaPayload = inboundPayload({
        phoneNumberId: `phone-beta-${suffix}`,
        wabaId: `waba-beta-${suffix}`,
        wamid: `wamid.beta.${suffix}`,
      });
      const events = await db.insert(schema.webhookEvents).values([
        {
          organizationId: alpha.id,
          phoneNumberId: `phone-alpha-${suffix}`,
          eventKey: `inbox-alpha-${suffix}`,
          payload: alphaPayload,
          processingStatus: "processed",
          processedAt: new Date(),
        },
        {
          organizationId: beta.id,
          phoneNumberId: `phone-beta-${suffix}`,
          eventKey: `inbox-beta-${suffix}`,
          payload: betaPayload,
          processingStatus: "processed",
          processedAt: new Date(),
        },
      ]).returning({ id: schema.webhookEvents.id, payload: schema.webhookEvents.payload });
      const [alphaEvent, betaEvent] = events;
      if (!alphaEvent || !betaEvent) throw new Error("Could not create webhook fixtures");

      await processInboxWebhookEvent(db, alphaEvent);
      await processInboxWebhookEvent(db, betaEvent);

      const alphaMessages = await db.select({ wamid: schema.inboxMessages.wamid })
        .from(schema.inboxMessages)
        .where(eq(schema.inboxMessages.organizationId, alpha.id));
      const betaMessages = await db.select({ wamid: schema.inboxMessages.wamid })
        .from(schema.inboxMessages)
        .where(eq(schema.inboxMessages.organizationId, beta.id));
      expect(alphaMessages).toEqual([{ wamid: `wamid.alpha.${suffix}` }]);
      expect(betaMessages).toEqual([{ wamid: `wamid.beta.${suffix}` }]);
    } finally {
      await db.delete(schema.organizations).where(eq(schema.organizations.id, alpha.id));
      await db.delete(schema.organizations).where(eq(schema.organizations.id, beta.id));
      await database.client.end({ timeout: 5 });
    }
  });
});
