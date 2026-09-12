export type TemplateComponent = {
  type: "header" | "body" | "button";
  sub_type?: "quick_reply" | "url";
  index?: string;
  parameters?: Array<
    | { type: "text"; text: string }
    | { type: "currency"; currency: { fallback_value: string; code: string; amount_1000: number } }
    | { type: "date_time"; date_time: { fallback_value: string } }
  >;
};

export type SendTemplateInput = {
  phoneNumberId: string;
  to: string;
  templateName: string;
  languageCode: string;
  components?: TemplateComponent[];
};

type CloudClientOptions = {
  accessToken: string;
  graphApiVersion: string;
};

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly responseBody: unknown,
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

async function assertMetaResponse(response: Response, message: string): Promise<unknown> {
  const body = await readJson(response);
  if (!response.ok) {
    throw new MetaApiError(message, response.status, body);
  }
  return body;
}

export class WhatsAppCloudClient {
  constructor(private readonly options: CloudClientOptions) {}

  async sendTemplate(input: SendTemplateInput): Promise<unknown> {
    const endpoint = `https://graph.facebook.com/${this.options.graphApiVersion}/${input.phoneNumberId}/messages`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: input.to,
        type: "template",
        template: {
          name: input.templateName,
          language: { code: input.languageCode },
          ...(input.components?.length ? { components: input.components } : {}),
        },
      }),
    });

    return assertMetaResponse(response, "Meta WhatsApp API request failed");
  }
}

type ExchangeEmbeddedSignupCodeInput = {
  code: string;
  appId: string;
  appSecret: string;
  graphApiVersion: string;
};

export type EmbeddedSignupToken = {
  accessToken: string;
  tokenType?: string;
  expiresIn?: number;
};

export async function exchangeEmbeddedSignupCode(
  input: ExchangeEmbeddedSignupCodeInput,
): Promise<EmbeddedSignupToken> {
  const endpoint = new URL(`https://graph.facebook.com/${input.graphApiVersion}/oauth/access_token`);
  endpoint.searchParams.set("client_id", input.appId);
  endpoint.searchParams.set("client_secret", input.appSecret);
  endpoint.searchParams.set("code", input.code);

  const response = await fetch(endpoint);
  const body = await assertMetaResponse(response, "Could not exchange Meta Embedded Signup code");

  if (!body || typeof body !== "object" || !("access_token" in body) || typeof body.access_token !== "string") {
    throw new MetaApiError("Meta token response did not include an access token", response.status, body);
  }

  return {
    accessToken: body.access_token,
    ...(("token_type" in body && typeof body.token_type === "string") ? { tokenType: body.token_type } : {}),
    ...(("expires_in" in body && typeof body.expires_in === "number") ? { expiresIn: body.expires_in } : {}),
  };
}

export type WhatsAppPhoneNumberDetails = {
  id: string;
  displayPhoneNumber?: string;
  verifiedName?: string;
  qualityRating?: string;
  platformType?: string;
  throughputLevel?: string;
};

type GetPhoneNumberInput = {
  phoneNumberId: string;
  accessToken: string;
  graphApiVersion: string;
};

export async function getWhatsAppPhoneNumber(
  input: GetPhoneNumberInput,
): Promise<WhatsAppPhoneNumberDetails> {
  const endpoint = new URL(`https://graph.facebook.com/${input.graphApiVersion}/${input.phoneNumberId}`);
  endpoint.searchParams.set(
    "fields",
    "id,display_phone_number,verified_name,quality_rating,platform_type,throughput",
  );

  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${input.accessToken}` },
  });
  const body = await assertMetaResponse(response, "Could not read the WhatsApp phone number from Meta");

  if (!body || typeof body !== "object" || !("id" in body) || typeof body.id !== "string") {
    throw new MetaApiError("Meta phone-number response was invalid", response.status, body);
  }

  const throughput = "throughput" in body && body.throughput && typeof body.throughput === "object"
    ? body.throughput
    : undefined;

  return {
    id: body.id,
    ...(("display_phone_number" in body && typeof body.display_phone_number === "string")
      ? { displayPhoneNumber: body.display_phone_number }
      : {}),
    ...(("verified_name" in body && typeof body.verified_name === "string")
      ? { verifiedName: body.verified_name }
      : {}),
    ...(("quality_rating" in body && typeof body.quality_rating === "string")
      ? { qualityRating: body.quality_rating }
      : {}),
    ...(("platform_type" in body && typeof body.platform_type === "string")
      ? { platformType: body.platform_type }
      : {}),
    ...(throughput && "level" in throughput && typeof throughput.level === "string"
      ? { throughputLevel: throughput.level }
      : {}),
  };
}

type SubscribeAppInput = {
  wabaId: string;
  accessToken: string;
  graphApiVersion: string;
};

export async function subscribeAppToWaba(input: SubscribeAppInput): Promise<void> {
  const endpoint = `https://graph.facebook.com/${input.graphApiVersion}/${input.wabaId}/subscribed_apps`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${input.accessToken}` },
  });
  await assertMetaResponse(response, "Could not subscribe the app to the client's WABA");
}

export function inferThroughputMps(level?: string): number {
  if (!level) return 80;
  const normalized = level.toUpperCase();
  return normalized.includes("HIGH") || normalized.includes("1000") ? 1_000 : 80;
}
