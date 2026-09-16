import { parseWhatsAppWebhook, type WhatsAppMessageStatus } from "./webhooks";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTimestampSeconds(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.floor(value);
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
}

export type InboxInboundMessageType =
  | "text"
  | "button"
  | "interactive"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "sticker"
  | "other";

export type InboxMediaReference = {
  id?: string;
  mimeType?: string;
  sha256?: string;
  fileName?: string;
  caption?: string;
};

export type InboxInboundMessage = {
  messageId: string;
  from: string;
  type: InboxInboundMessageType;
  timestampSeconds?: number;
  phoneNumberId?: string;
  businessDisplayPhoneNumber?: string;
  wabaId?: string;
  profileName?: string;
  text?: string;
  media?: InboxMediaReference;
  interactivePayload?: Record<string, unknown>;
};

export type ParsedInboxWebhook = {
  messages: InboxInboundMessage[];
  statuses: WhatsAppMessageStatus[];
};

function contactProfiles(value: JsonRecord): Map<string, string> {
  const profiles = new Map<string, string>();
  if (!Array.isArray(value.contacts)) return profiles;

  for (const candidate of value.contacts) {
    if (!isRecord(candidate) || typeof candidate.wa_id !== "string") continue;
    const profile = isRecord(candidate.profile) ? candidate.profile : undefined;
    if (profile && typeof profile.name === "string" && profile.name.trim()) {
      profiles.set(candidate.wa_id.replace(/\D/g, ""), profile.name.trim());
    }
  }
  return profiles;
}

function mediaReference(value: unknown): InboxMediaReference | undefined {
  if (!isRecord(value)) return undefined;
  const result: InboxMediaReference = {};
  if (typeof value.id === "string") result.id = value.id;
  if (typeof value.mime_type === "string") result.mimeType = value.mime_type;
  if (typeof value.sha256 === "string") result.sha256 = value.sha256;
  if (typeof value.filename === "string") result.fileName = value.filename;
  if (typeof value.caption === "string") result.caption = value.caption;
  return Object.keys(result).length ? result : undefined;
}

function parseMessage(
  item: JsonRecord,
  value: JsonRecord,
  phoneNumberId: string | undefined,
  businessDisplayPhoneNumber: string | undefined,
  wabaId: string | undefined,
): InboxInboundMessage | null {
  if (typeof item.id !== "string" || typeof item.from !== "string") return null;

  const rawType = typeof item.type === "string" ? item.type.toLowerCase() : "other";
  const supportedMedia = new Set(["image", "video", "audio", "document", "sticker"]);
  const profiles = contactProfiles(value);
  const senderKey = item.from.replace(/\D/g, "");
  const timestampSeconds = parseTimestampSeconds(item.timestamp);
  let type: InboxInboundMessageType = "other";
  let text: string | undefined;
  let media: InboxMediaReference | undefined;
  let interactivePayload: Record<string, unknown> | undefined;

  if (rawType === "text" && isRecord(item.text)) {
    type = "text";
    if (typeof item.text.body === "string") text = item.text.body;
  } else if (rawType === "button" && isRecord(item.button)) {
    type = "button";
    const title = typeof item.button.text === "string" ? item.button.text : undefined;
    const payload = typeof item.button.payload === "string" ? item.button.payload : undefined;
    text = title;
    interactivePayload = {
      kind: "button",
      ...(title ? { title } : {}),
      ...(payload ? { payload } : {}),
    };
  } else if (rawType === "interactive" && isRecord(item.interactive)) {
    type = "interactive";
    const buttonReply = isRecord(item.interactive.button_reply) ? item.interactive.button_reply : undefined;
    const listReply = isRecord(item.interactive.list_reply) ? item.interactive.list_reply : undefined;
    const reply = buttonReply ?? listReply;
    const kind = buttonReply ? "button_reply" : listReply ? "list_reply" : "interactive";
    const id = reply && typeof reply.id === "string" ? reply.id : undefined;
    const title = reply && typeof reply.title === "string" ? reply.title : undefined;
    const description = reply && typeof reply.description === "string" ? reply.description : undefined;
    text = title;
    interactivePayload = {
      kind,
      ...(id ? { id } : {}),
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
    };
  } else if (supportedMedia.has(rawType)) {
    type = rawType as Extract<InboxInboundMessageType, "image" | "video" | "audio" | "document" | "sticker">;
    media = mediaReference(item[rawType]);
    text = media?.caption;
  }

  return {
    messageId: item.id,
    from: item.from,
    type,
    ...(timestampSeconds !== undefined ? { timestampSeconds } : {}),
    ...(phoneNumberId ? { phoneNumberId } : {}),
    ...(businessDisplayPhoneNumber ? { businessDisplayPhoneNumber } : {}),
    ...(wabaId ? { wabaId } : {}),
    ...(profiles.get(senderKey) ? { profileName: profiles.get(senderKey) } : {}),
    ...(text ? { text } : {}),
    ...(media ? { media } : {}),
    ...(interactivePayload ? { interactivePayload } : {}),
  };
}

export function parseInboxWebhook(payload: unknown): ParsedInboxWebhook {
  const statuses = parseWhatsAppWebhook(payload).statuses;
  const messages: InboxInboundMessage[] = [];

  if (!isRecord(payload) || payload.object !== "whatsapp_business_account" || !Array.isArray(payload.entry)) {
    return { messages, statuses };
  }

  for (const entry of payload.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) continue;
    const wabaId = typeof entry.id === "string" ? entry.id : undefined;

    for (const change of entry.changes) {
      if (!isRecord(change) || !isRecord(change.value)) continue;
      const value = change.value;
      const metadata = isRecord(value.metadata) ? value.metadata : undefined;
      const phoneNumberId = metadata && typeof metadata.phone_number_id === "string"
        ? metadata.phone_number_id
        : undefined;
      const businessDisplayPhoneNumber = metadata && typeof metadata.display_phone_number === "string"
        ? metadata.display_phone_number
        : undefined;

      if (!Array.isArray(value.messages)) continue;
      for (const item of value.messages) {
        if (!isRecord(item)) continue;
        const parsed = parseMessage(item, value, phoneNumberId, businessDisplayPhoneNumber, wabaId);
        if (parsed) messages.push(parsed);
      }
    }
  }

  return { messages, statuses };
}
