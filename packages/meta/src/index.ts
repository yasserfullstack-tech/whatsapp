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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

  if (!isRecord(body) || typeof body.access_token !== "string") {
    throw new MetaApiError("Meta token response did not include an access token", response.status, body);
  }

  return {
    accessToken: body.access_token,
    ...(typeof body.token_type === "string" ? { tokenType: body.token_type } : {}),
    ...(typeof body.expires_in === "number" ? { expiresIn: body.expires_in } : {}),
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

  if (!isRecord(body) || typeof body.id !== "string") {
    throw new MetaApiError("Meta phone-number response was invalid", response.status, body);
  }

  const throughput = isRecord(body.throughput) ? body.throughput : undefined;

  return {
    id: body.id,
    ...(typeof body.display_phone_number === "string" ? { displayPhoneNumber: body.display_phone_number } : {}),
    ...(typeof body.verified_name === "string" ? { verifiedName: body.verified_name } : {}),
    ...(typeof body.quality_rating === "string" ? { qualityRating: body.quality_rating } : {}),
    ...(typeof body.platform_type === "string" ? { platformType: body.platform_type } : {}),
    ...(throughput && typeof throughput.level === "string" ? { throughputLevel: throughput.level } : {}),
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

export type MetaMessageTemplate = {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  components: unknown[];
  rejectedReason?: string;
};

function parseMessageTemplate(value: unknown): MetaMessageTemplate | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.language !== "string" ||
    typeof value.status !== "string" ||
    typeof value.category !== "string"
  ) {
    return null;
  }

  return {
    id: value.id,
    name: value.name,
    language: value.language,
    status: value.status,
    category: value.category,
    components: Array.isArray(value.components) ? value.components : [],
    ...(typeof value.rejected_reason === "string" ? { rejectedReason: value.rejected_reason } : {}),
  };
}

export async function listMessageTemplates(input: {
  wabaId: string;
  accessToken: string;
  graphApiVersion: string;
}): Promise<MetaMessageTemplate[]> {
  const templates: MetaMessageTemplate[] = [];
  let after: string | undefined;

  for (let page = 0; page < 100; page += 1) {
    const endpoint = new URL(`https://graph.facebook.com/${input.graphApiVersion}/${input.wabaId}/message_templates`);
    endpoint.searchParams.set("fields", "id,name,status,category,language,components,rejected_reason");
    endpoint.searchParams.set("limit", "100");
    if (after) endpoint.searchParams.set("after", after);

    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${input.accessToken}` },
    });
    const body = await assertMetaResponse(response, "Could not load message templates from Meta");
    if (!isRecord(body) || !Array.isArray(body.data)) {
      throw new MetaApiError("Meta message-template response was invalid", response.status, body);
    }

    for (const item of body.data) {
      const parsed = parseMessageTemplate(item);
      if (parsed) templates.push(parsed);
    }

    const paging = isRecord(body.paging) ? body.paging : undefined;
    const cursors = paging && isRecord(paging.cursors) ? paging.cursors : undefined;
    const nextAfter = cursors && typeof cursors.after === "string" ? cursors.after : undefined;
    if (!nextAfter || nextAfter === after) break;
    after = nextAfter;
  }

  return templates;
}

export type CreateMessageTemplateInput = {
  wabaId: string;
  accessToken: string;
  graphApiVersion: string;
  name: string;
  language: string;
  category: "MARKETING" | "UTILITY";
  bodyText: string;
  bodyExamples?: string[];
  footerText?: string;
};

export type CreatedMessageTemplate = {
  id: string;
  status?: string;
  category?: string;
};

export async function createMessageTemplate(
  input: CreateMessageTemplateInput,
): Promise<CreatedMessageTemplate> {
  const components: Record<string, unknown>[] = [
    {
      type: "BODY",
      text: input.bodyText,
      ...(input.bodyExamples?.length ? { example: { body_text: [input.bodyExamples] } } : {}),
    },
  ];

  if (input.footerText) {
    components.push({ type: "FOOTER", text: input.footerText });
  }

  const endpoint = `https://graph.facebook.com/${input.graphApiVersion}/${input.wabaId}/message_templates`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: input.name,
      language: input.language,
      category: input.category,
      components,
    }),
  });

  const body = await assertMetaResponse(response, "Could not create message template in Meta");
  if (!isRecord(body) || typeof body.id !== "string") {
    throw new MetaApiError("Meta create-template response was invalid", response.status, body);
  }

  return {
    id: body.id,
    ...(typeof body.status === "string" ? { status: body.status } : {}),
    ...(typeof body.category === "string" ? { category: body.category } : {}),
  };
}

export function extractTemplateBodyPreview(components: unknown[]): string | undefined {
  for (const component of components) {
    if (!isRecord(component)) continue;
    if (typeof component.type === "string" && component.type.toUpperCase() === "BODY" && typeof component.text === "string") {
      return component.text;
    }
  }
  return undefined;
}
