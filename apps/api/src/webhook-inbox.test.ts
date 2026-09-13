import { describe, expect, test } from "bun:test";
import {
  WebhookPersistenceError,
  WebhookQueueError,
  persistAndQueueWebhook,
  webhookEventKey,
} from "./webhook-inbox";

describe("durable webhook inbox ingest", () => {
  test("deduplicates the same payload even when Meta sends it 10 times", async () => {
    const rows = new Map<string, { id: string; processedAt: Date | null }>();
    const queuedJobIds = new Set<string>();
    const rawBody = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ id: "waba-1", changes: [] }],
    });

    for (let index = 0; index < 10; index += 1) {
      await persistAndQueueWebhook({
        rawBody,
        payload: JSON.parse(rawBody),
        phoneNumberId: "phone-1",
      }, {
        persist: async ({ eventKey }) => {
          const existing = rows.get(eventKey);
          if (existing) return existing;
          const inserted = { id: "event-1", processedAt: null };
          rows.set(eventKey, inserted);
          return inserted;
        },
        enqueue: async (eventId) => {
          queuedJobIds.add(`webhook-${eventId}`);
        },
      });
    }

    expect(rows.size).toBe(1);
    expect(queuedJobIds).toEqual(new Set(["webhook-event-1"]));
    expect([...rows.keys()]).toEqual([webhookEventKey(rawBody)]);
  });

  test("retries queueing from the same durable event after Redis is unavailable", async () => {
    const durable = { id: "event-redis-retry", processedAt: null as Date | null };
    let queueAvailable = false;
    let enqueueCalls = 0;
    const dependencies = {
      persist: async () => durable,
      enqueue: async () => {
        enqueueCalls += 1;
        if (!queueAvailable) throw new Error("ECONNREFUSED");
      },
    };

    await expect(persistAndQueueWebhook({
      rawBody: "{}",
      payload: {},
      phoneNumberId: null,
    }, dependencies)).rejects.toBeInstanceOf(WebhookQueueError);

    queueAvailable = true;
    await expect(persistAndQueueWebhook({
      rawBody: "{}",
      payload: {},
      phoneNumberId: null,
    }, dependencies)).resolves.toEqual(durable);

    expect(enqueueCalls).toBe(2);
  });

  test("returns a persistence failure so Meta can retry when the database is unavailable", async () => {
    await expect(persistAndQueueWebhook({
      rawBody: "{}",
      payload: {},
      phoneNumberId: null,
    }, {
      persist: async () => {
        throw new Error("database unavailable");
      },
      enqueue: async () => undefined,
    })).rejects.toBeInstanceOf(WebhookPersistenceError);
  });

  test("does not requeue an already processed replay", async () => {
    let queued = false;
    await persistAndQueueWebhook({
      rawBody: "{}",
      payload: {},
      phoneNumberId: null,
    }, {
      persist: async () => ({ id: "processed-event", processedAt: new Date() }),
      enqueue: async () => {
        queued = true;
      },
    });
    expect(queued).toBe(false);
  });
});
