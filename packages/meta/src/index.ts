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

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new MetaApiError("Meta WhatsApp API request failed", response.status, body);
    }

    return body;
  }
}
