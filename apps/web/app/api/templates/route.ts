import { NextResponse } from "next/server";
import { z } from "zod";
import { schema } from "@wa/db";
import { extractTemplateBodyPreview, MetaApiError } from "@wa/meta";
import { createStructuredMessageTemplate } from "@wa/meta/template-management";
import { analyzeTemplateComponents } from "@wa/meta/templates";
import { getAuthContext } from "@/lib/auth-context";
import { getWabaAccessToken, listConnectedWabas } from "@/lib/meta-credentials";
import { db, getMetaServerConfig } from "@/lib/server";
import { normalizeTemplateCategory, normalizeTemplateStatus } from "@/lib/template-sync";
import { can } from "@/lib/workspace-access";

const componentSchema = z.record(z.string(), z.unknown());
const createSchema = z.object({
  wabaId: z.string().min(1).max(128),
  name: z.string().trim().min(1).max(512).regex(/^[a-z0-9_]+$/, "Use lowercase letters, numbers, and underscores only"),
  language: z.string().trim().min(2).max(16).regex(/^[A-Za-z]{2,3}(?:_[A-Za-z]{2})?$/),
  category: z.enum(["marketing", "utility"]),
  components: z.array(componentSchema).min(1).max(10).optional(),
  body: z.string().trim().min(1).max(1024).optional(),
  footer: z.string().trim().max(60).optional(),
  examples: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
}).superRefine((value, context) => {
  if (!value.components?.length && !value.body) {
    context.addIssue({ code: "custom", message: "Template components or body text are required" });
  }
});

function positionalVariables(body: string): number[] {
  const indexes = [...body.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));
  return [...new Set(indexes)].sort((a, b) => a - b);
}

function legacyComponents(body: string, footer: string | undefined, examples: string[]): Record<string, unknown>[] {
  return [
    {
      type: "BODY",
      text: body,
      ...(examples.length ? { example: { body_text: [examples] } } : {}),
    },
    ...(footer ? [{ type: "FOOTER", text: footer }] : []),
  ];
}

export async function POST(request: Request) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(context.workspace.role, "templates.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid template", issues: parsed.error.issues }, { status: 400 });
  }

  const connected = await listConnectedWabas(context.workspace.organizationId);
  if (!connected.some((item) => item.wabaId === parsed.data.wabaId)) {
    return NextResponse.json({ error: "That WABA is not connected to this workspace" }, { status: 403 });
  }

  if (!parsed.data.components && parsed.data.body) {
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
  }

  const components = parsed.data.components ?? legacyComponents(parsed.data.body!, parsed.data.footer, parsed.data.examples);
  const analysis = analyzeTemplateComponents(components);
  if (!analysis.supported) {
    return NextResponse.json({ error: "Unsupported rich template", issues: analysis.errors }, { status: 400 });
  }
  const bodyPreview = extractTemplateBodyPreview(components);
  if (!bodyPreview) return NextResponse.json({ error: "Template body text is required" }, { status: 400 });

  const accessToken = await getWabaAccessToken(context.workspace.organizationId, parsed.data.wabaId);
  const meta = getMetaServerConfig();

  try {
    const created = await createStructuredMessageTemplate({
      wabaId: parsed.data.wabaId,
      accessToken,
      graphApiVersion: meta.graphApiVersion,
      name: parsed.data.name,
      language: parsed.data.language,
      category: parsed.data.category === "marketing" ? "MARKETING" : "UTILITY",
      components,
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
        bodyPreview,
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
          bodyPreview,
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
