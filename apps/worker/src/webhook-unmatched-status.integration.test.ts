import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import type { Job } from "bullmq";
import { eq } from "drizzle-orm";
import { createDatabase, schema } from "@wa/db";
import type { WebhookProcessJob } from "@wa/queue";
import { processWebhookEvent } from "./webhook-processing";
import { UNMATCHED_STATUS_RETRY_WINDOW_MS } from "./webhook-runtime-context";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for unmatched status webhook tests");

function payload(phoneNumberId: string, wabaId: string, statusWamid: string, stopFrom?: string) {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: wabaId,
      changes: [{
        field: "messages",
        value: {
          metadata: { phone_number_id: phoneNumberId, display_phone_number: "+15550001000" },
          statuses: [{ id: statusWamid, status: "delivered", timestamp: "1789590000", recipient_id: "15550008888" }],
          ...(stopFrom ? {
            messages: [{ id: `wamid.stop.${randomUUID()}`, from: stopFrom, timestamp: "1789590000", type: "text", text: { body: "STOP" } }],
          } : {}),
        },
      }],
    }],
  };
}

describe("unmatched status webhooks", () => {
  test("retry only while fresh, after opt-outs apply, and never for inbox replies", async () => {
    const database = createDatabase(databaseUrl);
    const db = database.db;
    const suffix = randomUUID();
    const phoneNumberId = `phone-${suffix}`;
    const wabaId = `waba-${suffix}`;
    const [organization] = await db.insert(schema.organizations).values({
      name: `Unmatched status ${suffix}`,
      slug: `unmatched-status-${suffix}`,
    }).returning({ id: schema.organizations.id });
    if (!organization) throw new Error("Could not create organization fixture");

    const run = async (eventPayload: unknown, createdAt: Date) => {
      const [event] = await db.insert(schema.webhookEvents).values({
        organizationId: organization.id,
        phoneNumberId,
        eventKey: `unmatched-${randomUUID()}`,
        payload: eventPayload,
        createdAt,
      }).returning({ id: schema.webhookEvents.id });
      if (!event) throw new Error("Could not create webhook event fixture");
      const outcome = await processWebhookEvent(db, { id: event.id, data: { eventId: event.id } } as Job<WebhookProcessJob>)
        .then(() => "processed", () => "retry");
      const [row] = await db.select({ processedAt: schema.webhookEvents.processedAt })
        .from(schema.webhookEvents).where(eq(schema.webhookEvents.id, event.id));
      return { outcome, processed: row?.processedAt != null };
    };

    try {
      const [phone] = await db.insert(schema.whatsappPhoneNumbers).values({
        organizationId: organization.id,
        wabaId,
        phoneNumberId,
        status: "connected",
        credentialKey: `org/${organization.id}/whatsapp/${phoneNumberId}/access-token`,
      }).returning({ id: schema.whatsappPhoneNumbers.id });
      if (!phone) throw new Error("Could not create phone fixture");

      // Fresh unmatched campaign status retries, but the STOP in the same payload is applied first.
      const fresh = await run(payload(phoneNumberId, wabaId, `wamid.unknown.${suffix}`, "15550007777"), new Date());
      expect(fresh).toEqual({ outcome: "retry", processed: false });
      const suppressed = await db.select({ phoneE164: schema.suppressionList.phoneE164 })
        .from(schema.suppressionList).where(eq(schema.suppressionList.organizationId, organization.id));
      expect(suppressed).toEqual([{ phoneE164: "+15550007777" }]);

      // Past the window, a status for a message this app never sent is accepted.
      const stale = await run(
        payload(phoneNumberId, wabaId, `wamid.foreign.${suffix}`),
        new Date(Date.now() - UNMATCHED_STATUS_RETRY_WINDOW_MS - 1_000),
      );
      expect(stale).toEqual({ outcome: "processed", processed: true });

      // An inbox reply's status is processed immediately so the inbox projection can apply it.
      const [conversation] = await db.insert(schema.inboxConversations).values({
        organizationId: organization.id,
        whatsappPhoneNumberId: phone.id,
        customerPhoneE164: "+15550008888",
      }).returning({ id: schema.inboxConversations.id });
      if (!conversation) throw new Error("Could not create conversation fixture");
      await db.insert(schema.inboxMessages).values({
        organizationId: organization.id,
        conversationId: conversation.id,
        whatsappPhoneNumberId: phone.id,
        direction: "outbound",
        source: "agent_reply",
        status: "sent",
        wamid: `wamid.inbox.${suffix}`,
      });
      const inbox = await run(payload(phoneNumberId, wabaId, `wamid.inbox.${suffix}`), new Date());
      expect(inbox).toEqual({ outcome: "processed", processed: true });
    } finally {
      await db.delete(schema.organizations).where(eq(schema.organizations.id, organization.id));
      await database.client.end({ timeout: 5 });
    }
  });
});
