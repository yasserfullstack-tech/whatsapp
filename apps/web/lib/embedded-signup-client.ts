export type EmbeddedSignupData = {
  wabaId: string;
  phoneNumberId: string;
  businessId?: string;
};

export type EmbeddedSignupLoginOptions = {
  config_id: string;
  response_type: "code";
  override_default_response_type: true;
  extras: {
    setup: Record<string, never>;
  };
};

export type EmbeddedSignupMessage =
  | { kind: "ignore" }
  | { kind: "cancel" }
  | { kind: "error" }
  | { kind: "invalid" }
  | { kind: "finish"; data: EmbeddedSignupData };

const FACEBOOK_EMBEDDED_SIGNUP_ORIGINS = new Set([
  "https://www.facebook.com",
  "https://web.facebook.com",
]);

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Meta Embedded Signup v4 keeps products, assets, and permissions in the
 * Facebook Login for Business configuration. The client launch only passes
 * the configuration ID plus an empty setup object.
 *
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation
 */
export function createEmbeddedSignupLoginOptions(configId: string): EmbeddedSignupLoginOptions {
  return {
    config_id: configId,
    response_type: "code",
    override_default_response_type: true,
    extras: {
      setup: {},
    },
  };
}

export function parseEmbeddedSignupMessage(origin: string, rawPayload: unknown): EmbeddedSignupMessage {
  if (!FACEBOOK_EMBEDDED_SIGNUP_ORIGINS.has(origin)) return { kind: "ignore" };

  let payload = rawPayload;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload) as unknown;
    } catch {
      return { kind: "ignore" };
    }
  }

  if (!payload || typeof payload !== "object") return { kind: "ignore" };

  const record = payload as Record<string, unknown>;
  if (record.type !== "WA_EMBEDDED_SIGNUP") return { kind: "ignore" };

  if (record.event === "CANCEL") return { kind: "cancel" };
  if (record.event === "ERROR") return { kind: "error" };
  if (record.event !== "FINISH") return { kind: "invalid" };
  if (!record.data || typeof record.data !== "object") return { kind: "invalid" };

  const data = record.data as Record<string, unknown>;
  const wabaId = nonEmptyString(data.waba_id);
  const phoneNumberId = nonEmptyString(data.phone_number_id);
  if (!wabaId || !phoneNumberId) return { kind: "invalid" };

  const businessId = data.business_id === undefined ? null : nonEmptyString(data.business_id);
  if (data.business_id !== undefined && !businessId) return { kind: "invalid" };

  return {
    kind: "finish",
    data: {
      wabaId,
      phoneNumberId,
      ...(businessId ? { businessId } : {}),
    },
  };
}
