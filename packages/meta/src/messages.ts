import { MetaApiError } from "./index";

export type SendWhatsAppTextInput = {
  phoneNumberId: string;
  to: string;
  text: string;
  accessToken: string;
  graphApiVersion: string;
  replyToMessageId?: string;
};

export type SentWhatsAppTextMessage = {
  messageId: string;
  waId?: string;
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function buildTextMessagePayload(input: Pick<SendWhatsAppTextInput, "to" | "text" | "replyToMessageId">) {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: input.to,
    type: "text",
    ...(input.replyToMessageId ? { context: { message_id: input.replyToMessageId } } : {}),
    text: {
      preview_url: false,
      body: input.text,
    },
  };
}

export async function sendWhatsAppText(input: SendWhatsAppTextInput): Promise<SentWhatsAppTextMessage> {
  const endpoint = `https://graph.facebook.com/${input.graphApiVersion}/${input.phoneNumberId}/messages`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildTextMessagePayload(input)),
  });
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new MetaApiError("Meta WhatsApp text reply failed", response.status, body);
  }
  if (!isRecord(body) || !Array.isArray(body.messages) || !isRecord(body.messages[0]) || typeof body.messages[0].id !== "string") {
    throw new MetaApiError("Meta text reply response did not include a WhatsApp message ID", response.status, body);
  }

  const firstContact = Array.isArray(body.contacts) && isRecord(body.contacts[0]) ? body.contacts[0] : undefined;
  return {
    messageId: body.messages[0].id,
    ...(firstContact && typeof firstContact.wa_id === "string" ? { waId: firstContact.wa_id } : {}),
  };
}
