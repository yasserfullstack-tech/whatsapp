import { NextResponse } from "next/server";
import { z } from "zod";
import { schema } from "@wa/db";
import { createMessageTemplate, MetaApiError } from "@wa/meta";
import { getAuthContext } from "@/lib/auth-context";
import { getWabaAccessToken, listConnectedWabas } from "@/lib/meta-credentials";
import { db, getMetaServerConfig } from "@/lib/server";
import { normalizeTemplateCategory, normalizeTemplateStatus } from "@/lib/template-sync";

const createSchema = z.object({
  wabaId: z.string().min(1).max(128),
  name: z.string().trim().min(1).max(512).regex(/^[a-z0-9_]+$/, "Use lowercase letters, numbers, and underscores only"),
  language: z.string().trim().min(2).max(16).regex(/^[A-Za-z]{2,3}(?:_[A-Za-z]{2})?$/),
  category: z.enum(["marketing", "utility"]),
  body: z.string().trim().min(1).max(1024),
  footer: z.string().trim().max(60).optional(),
  examples: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
});

function positionalVariables(body: string): number[] {
  const indexes = [...body.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));
  return [...new Set(indexes)].sort((a, b) => a - b);
}

export async function POST(request: Request) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid template", issues: parsed.error.issues }, { status: 400 });
  }

  const connected = await listConnectedWabas(context.workspace.organizationId);
  if (!connected.some((item) => item.wabaId === parsed.data.wabaId)) {
    return NextResponse.json({ error: "That WABA is not connected to this workspace" }, { status: 403 });
  }

  const variables = positionalVariables(parsed.data.body);
  if (parsed.data.body.includes("{{") && variables.length === 0) {
    return NextResponse.json({ error: "Only positional variables such as {{1}} and {{2}} are supported" }, { status: 400 });
  }
  for (let index = 0; index < variables.length; index += 1) {
    if (variables[index] !== index + 1) {
      return NextResponse.json({ error: "Template variables must be sequential: {{1}}, {{2}}, {{3}}, ..." }, { status: 400 });
    }
  }
  if (variables.length !== parsed.data.examples.length) {
    return NextResponse.json({
      error: variables.length
        ? `Provide exactly ${variables.length} example value${variables.length === 1 ? "" : "s"} for Meta review`
        : "Remove example values because the body has no variables",
    }, { status: 400 });
  }

  const accessToken = await getWabaAccessToken(context.workspace.organizationId, parsed.data.wabaId);
  const meta = getMetaServerConfig();
  const components: unknown[] = [
    {
      type: "BODY",
      text: parsed.data.body,
      ...(parsed.data.examples.length ? { example: { body_text: [parsed.data.examples] } } : {}),
    },
    ...(parsed.data.footer ? [{ type: "FOOTER", text: parsed.data.footer }] : []),
  ];

  try {
    const created = await createMessageTemplate({
      wabaId: parsed.data.wabaId,
      accessToken,
      graphApiVersion: meta.graphApiVersion,
      name: parsed.data.name,
      language: parsed.data.language,
      category: parsed.data.category === "marketing" ? "MARKETING" : "UTILITY",
      bodyText: parsed.data.body,
      ...(parsed.data.examples.length ? { bodyExamples: parsed.data.examples } : {}),
      ...(parsed.data.footer ? { footerText: parsed.data.footer } : {}),
    });

    const now = new Date();
    const metaStatus = created.status ?? "PENDING";
    const metaCategory = created.category ?? parsed.data.category.toUpperCase();

    await db
      .insert(schema.templates)
      .values({
        organizationId: context.workspace.organizationId,
        wabaId: parsed.data.wabaId,
        metaTemplateId: created.id,
        name: parsed.data.name,
        language: parsed.data.language,
        category: normalizeTemplateCategory(metaCategory),
        status: normalizeTemplateStatus(metaStatus),
        metaStatus,
        bodyPreview: parsed.data.body,
        components,
        lastSyncedAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.templates.organizationId, schema.templates.wabaId, schema.templates.name, schema.templates.language],
        set: {
          metaTemplateId: created.id,
          category: normalizeTemplateCategory(metaCategory),
          status: normalizeTemplateStatus(metaStatus),
          metaStatus,
          bodyPreview: parsed.data.body,
          components,
          rejectionReason: null,
          lastSyncedAt: now,
          updatedAt: now,
        },
      });

    return NextResponse.json({ id: created.id, status: metaStatus, category: metaCategory }, { status: 201 });
  } catch (error) {
    if (error instanceof MetaApiError) {
      console.error("Template creation failed", { status: error.status, responseBody: error.responseBody });
      return NextResponse.json({ error: "Meta rejected the template request", meta: error.responseBody }, { status: 422 });
    }
    console.error("Template creation failed", error);
    return NextResponse.json({ error: "Could not create message template" }, { status: 500 });
  }
}
