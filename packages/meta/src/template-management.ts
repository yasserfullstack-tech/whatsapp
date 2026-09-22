import { MetaApiError } from "./index";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type CreateStructuredMessageTemplateInput = {
  wabaId: string;
  accessToken: string;
  graphApiVersion: string;
  name: string;
  language: string;
  category: "MARKETING" | "UTILITY";
  components: Record<string, unknown>[];
};

export type CreatedStructuredMessageTemplate = {
  id: string;
  status?: string;
  category?: string;
};

export async function createStructuredMessageTemplate(
  input: CreateStructuredMessageTemplateInput,
): Promise<CreatedStructuredMessageTemplate> {
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
      components: input.components,
    }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new MetaApiError("Could not create message template in Meta", response.status, body);
  }
  if (!isRecord(body) || typeof body.id !== "string") {
    throw new MetaApiError("Meta create-template response was invalid", response.status, body);
  }
  return {
    id: body.id,
    ...(typeof body.status === "string" ? { status: body.status } : {}),
    ...(typeof body.category === "string" ? { category: body.category } : {}),
  };
}
