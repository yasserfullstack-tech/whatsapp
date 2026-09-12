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

export type ParsedWhatsAppWebhook = {
  phoneNumberIds: string[];
  statuses: WhatsAppMessageStatus[];
};

const supportedStatuses = new Set(["sent", "delivered", "read", "failed"] as const);

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

export function parseWhatsAppWebhook(payload: unknown): ParsedWhatsAppWebhook {
  const phoneNumberIds = new Set<string>();
  const statuses: WhatsAppMessageStatus[] = [];

  if (!isRecord(payload) || payload.object !== "whatsapp_business_account" || !Array.isArray(payload.entry)) {
    return { phoneNumberIds: [], statuses: [] };
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
      if (phoneNumberId) phoneNumberIds.add(phoneNumberId);
      if (!Array.isArray(value.statuses)) continue;

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
  }

  return { phoneNumberIds: [...phoneNumberIds], statuses };
}
