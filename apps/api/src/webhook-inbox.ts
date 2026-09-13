import { createHash } from "node:crypto";

export type DurableWebhookEvent = {
  id: string;
  processedAt: Date | null;
};

export class WebhookPersistenceError extends Error {
  override name = "WebhookPersistenceError";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

export class WebhookQueueError extends Error {
  override name = "WebhookQueueError";

  constructor(
    message: string,
    readonly eventId: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export function webhookEventKey(rawBody: string): string {
  return `sha256:${createHash("sha256").update(rawBody, "utf8").digest("hex")}`;
}

export async function persistAndQueueWebhook(input: {
  rawBody: string;
  payload: unknown;
  phoneNumberId: string | null;
}, dependencies: {
  persist: (event: {
    eventKey: string;
    payload: unknown;
    phoneNumberId: string | null;
  }) => Promise<DurableWebhookEvent | null>;
  enqueue: (eventId: string) => Promise<unknown>;
}): Promise<DurableWebhookEvent> {
  const eventKey = webhookEventKey(input.rawBody);

  let event: DurableWebhookEvent | null;
  try {
    event = await dependencies.persist({
      eventKey,
      payload: input.payload,
      phoneNumberId: input.phoneNumberId,
    });
  } catch (error) {
    throw new WebhookPersistenceError("Could not persist webhook", { cause: error });
  }

  if (!event) {
    throw new WebhookPersistenceError("Could not persist webhook");
  }

  if (!event.processedAt) {
    try {
      await dependencies.enqueue(event.id);
    } catch (error) {
      throw new WebhookQueueError(
        "Webhook persisted but processing is temporarily unavailable",
        event.id,
        { cause: error },
      );
    }
  }

  return event;
}
