type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type WhatsAppWebhookError = {
  code?: string;
  title?: string;
  message?: string;
  details?: string;
};

export type WhatsAppMessageStatus = {
  wamid: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestampSeconds?: number;
  recipientId?: string;
  phoneNumberId?: string;
  wabaId?: string;
  errors: WhatsAppWebhookError[];
};

export type WhatsAppInboundMessage = {
  messageId: string;
  from: string;
  type: "text" | "button" | "interactive" | "other";
  text?: string;
  buttonText?: string;
  buttonPayload?: string;
  timestampSeconds?: number;
  phoneNumberId?: string;
  wabaId?: string;
};

export type WhatsAppMetaAssetEvent =
  | {
      kind: "template_status";
      wabaId: string;
      timestampSeconds?: number;
      templateId: string;
      templateName?: string;
      language?: string;
      event: string;
      reason?: string;
    }
  | {
      kind: "phone_name";
      wabaId: string;
      timestampSeconds?: number;
      displayPhoneNumber?: string;
      decision?: string;
      requestedVerifiedName?: string;
      rejectionReason?: string;
    }
  | {
      kind: "phone_quality";
      wabaId: string;
      timestampSeconds?: number;
      displayPhoneNumber?: string;
      event?: string;
      currentLimit?: string;
    }
  | {
      kind: "account_update";
      wabaId: string;
      timestampSeconds?: number;
      event?: string;
      banState?: string;
      banDate?: string;
    }
  | {
      kind: "account_review";
      wabaId: string;
      timestampSeconds?: number;
      decision?: string;
    };

export type ParsedWhatsAppWebhook = {
  phoneNumberIds: string[];
  statuses: WhatsAppMessageStatus[];
  messages: WhatsAppInboundMessage[];
  assetEvents: WhatsAppMetaAssetEvent[];
};

const supportedStatuses = new Set(["sent", "delivered", "read", "failed"] as const);
const optOutSignals = new Set([
  "stop",
  "stop all",
  "stop promotions",
  "stop promos",
  "unsubscribe",
  "unsubscribe all",
  "unsubscribe from all",
  "unsubscribe from promos",
  "cancel",
  "end",
  "quit",
]);

function parseTimestampSeconds(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.floor(value);
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
}

function parseErrors(value: unknown): WhatsAppWebhookError[] {
  if (!Array.isArray(value)) return [];
  const errors: WhatsAppWebhookError[] = [];

  for (const item of value) {
    if (!isRecord(item)) continue;
    const errorData = isRecord(item.error_data) ? item.error_data : undefined;
    const code = typeof item.code === "string" || typeof item.code === "number" ? String(item.code) : undefined;
    const title = typeof item.title === "string" ? item.title : undefined;
    const message = typeof item.message === "string" ? item.message : undefined;
    const details = typeof item.details === "string"
      ? item.details
      : errorData && typeof errorData.details === "string"
        ? errorData.details
        : undefined;

    errors.push({
      ...(code ? { code } : {}),
      ...(title ? { title } : {}),
      ...(message ? { message } : {}),
      ...(details ? { details } : {}),
    });
  }

  return errors;
}

function normalizeOptOutSignal(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

export function isMarketingOptOutMessage(message: WhatsAppInboundMessage): boolean {
  const candidates = [message.text, message.buttonText, message.buttonPayload]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  return candidates.some((value) => optOutSignals.has(normalizeOptOutSignal(value)));
}

function parseInboundMessage(
  item: JsonRecord,
  phoneNumberId: string | undefined,
  wabaId: string | undefined,
): WhatsAppInboundMessage | null {
  if (typeof item.id !== "string" || typeof item.from !== "string") return null;

  const rawType = typeof item.type === "string" ? item.type.toLowerCase() : "other";
  const timestampSeconds = parseTimestampSeconds(item.timestamp);
  let type: WhatsAppInboundMessage["type"] = "other";
  let text: string | undefined;
  let buttonText: string | undefined;
  let buttonPayload: string | undefined;

  if (rawType === "text" && isRecord(item.text)) {
    type = "text";
    if (typeof item.text.body === "string") text = item.text.body;
  } else if (rawType === "button" && isRecord(item.button)) {
    type = "button";
    if (typeof item.button.text === "string") buttonText = item.button.text;
    if (typeof item.button.payload === "string") buttonPayload = item.button.payload;
  } else if (rawType === "interactive" && isRecord(item.interactive)) {
    type = "interactive";
    const reply = isRecord(item.interactive.button_reply) ? item.interactive.button_reply : undefined;
    if (reply && typeof reply.title === "string") buttonText = reply.title;
    if (reply && typeof reply.id === "string") buttonPayload = reply.id;
  }

  return {
    messageId: item.id,
    from: item.from,
    type,
    ...(text ? { text } : {}),
    ...(buttonText ? { buttonText } : {}),
    ...(buttonPayload ? { buttonPayload } : {}),
    ...(timestampSeconds !== undefined ? { timestampSeconds } : {}),
    ...(phoneNumberId ? { phoneNumberId } : {}),
    ...(wabaId ? { wabaId } : {}),
  };
}

function parseAssetEvent(
  field: string | undefined,
  value: JsonRecord,
  wabaId: string | undefined,
  timestampSeconds: number | undefined,
): WhatsAppMetaAssetEvent | null {
  if (!field || !wabaId) return null;

  if (field === "message_template_status_update") {
    if (typeof value.message_template_id !== "string" || typeof value.event !== "string") return null;
    return {
      kind: "template_status",
      wabaId,
      ...(timestampSeconds !== undefined ? { timestampSeconds } : {}),
      templateId: value.message_template_id,
      ...(typeof value.message_template_name === "string" ? { templateName: value.message_template_name } : {}),
      ...(typeof value.message_template_language === "string" ? { language: value.message_template_language } : {}),
      event: value.event.toUpperCase(),
      ...(typeof value.reason === "string" ? { reason: value.reason } : {}),
    };
  }

  if (field === "phone_number_name_update") {
    return {
      kind: "phone_name",
      wabaId,
      ...(timestampSeconds !== undefined ? { timestampSeconds } : {}),
      ...(typeof value.display_phone_number === "string" ? { displayPhoneNumber: value.display_phone_number } : {}),
      ...(typeof value.decision === "string" ? { decision: value.decision.toUpperCase() } : {}),
      ...(typeof value.requested_verified_name === "string" ? { requestedVerifiedName: value.requested_verified_name } : {}),
      ...(typeof value.rejection_reason === "string" ? { rejectionReason: value.rejection_reason } : {}),
    };
  }

  if (field === "phone_number_quality_update") {
    return {
      kind: "phone_quality",
      wabaId,
      ...(timestampSeconds !== undefined ? { timestampSeconds } : {}),
      ...(typeof value.display_phone_number === "string" ? { displayPhoneNumber: value.display_phone_number } : {}),
      ...(typeof value.event === "string" ? { event: value.event.toUpperCase() } : {}),
      ...(typeof value.current_limit === "string" ? { currentLimit: value.current_limit } : {}),
    };
  }

  if (field === "account_update") {
    const banInfo = isRecord(value.ban_info) ? value.ban_info : undefined;
    return {
      kind: "account_update",
      wabaId,
      ...(timestampSeconds !== undefined ? { timestampSeconds } : {}),
      ...(typeof value.event === "string" ? { event: value.event.toUpperCase() } : {}),
      ...(banInfo && typeof banInfo.waba_ban_state === "string" ? { banState: banInfo.waba_ban_state.toUpperCase() } : {}),
      ...(banInfo && typeof banInfo.waba_ban_date === "string" ? { banDate: banInfo.waba_ban_date } : {}),
    };
  }

  if (field === "account_review_update") {
    return {
      kind: "account_review",
      wabaId,
      ...(timestampSeconds !== undefined ? { timestampSeconds } : {}),
      ...(typeof value.decision === "string" ? { decision: value.decision.toUpperCase() } : {}),
    };
  }

  return null;
}

export function parseWhatsAppWebhook(payload: unknown): ParsedWhatsAppWebhook {
  const phoneNumberIds = new Set<string>();
  const statuses: WhatsAppMessageStatus[] = [];
  const messages: WhatsAppInboundMessage[] = [];
  const assetEvents: WhatsAppMetaAssetEvent[] = [];

  if (!isRecord(payload) || payload.object !== "whatsapp_business_account" || !Array.isArray(payload.entry)) {
    return { phoneNumberIds: [], statuses: [], messages: [], assetEvents: [] };
  }

  for (const entry of payload.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) continue;
    const wabaId = typeof entry.id === "string" ? entry.id : undefined;
    const entryTimestampSeconds = parseTimestampSeconds(entry.time);

    for (const change of entry.changes) {
      if (!isRecord(change) || !isRecord(change.value)) continue;
      const value = change.value;
      const field = typeof change.field === "string" ? change.field.toLowerCase() : undefined;
      const assetEvent = parseAssetEvent(field, value, wabaId, entryTimestampSeconds);
      if (assetEvent) assetEvents.push(assetEvent);

      const metadata = isRecord(value.metadata) ? value.metadata : undefined;
      const phoneNumberId = metadata && typeof metadata.phone_number_id === "string"
        ? metadata.phone_number_id
        : undefined;
      if (phoneNumberId) phoneNumberIds.add(phoneNumberId);

      if (Array.isArray(value.statuses)) {
        for (const item of value.statuses) {
          if (!isRecord(item) || typeof item.id !== "string" || typeof item.status !== "string") continue;
          const normalizedStatus = item.status.toLowerCase();
          if (!supportedStatuses.has(normalizedStatus as WhatsAppMessageStatus["status"])) continue;

          const timestampSeconds = parseTimestampSeconds(item.timestamp);
          statuses.push({
            wamid: item.id,
            status: normalizedStatus as WhatsAppMessageStatus["status"],
            ...(timestampSeconds !== undefined ? { timestampSeconds } : {}),
            ...(typeof item.recipient_id === "string" ? { recipientId: item.recipient_id } : {}),
            ...(phoneNumberId ? { phoneNumberId } : {}),
            ...(wabaId ? { wabaId } : {}),
            errors: parseErrors(item.errors),
          });
        }
      }

      if (Array.isArray(value.messages)) {
        for (const item of value.messages) {
          if (!isRecord(item)) continue;
          const parsed = parseInboundMessage(item, phoneNumberId, wabaId);
          if (parsed) messages.push(parsed);
        }
      }
    }
  }

  return { phoneNumberIds: [...phoneNumberIds], statuses, messages, assetEvents };
}
