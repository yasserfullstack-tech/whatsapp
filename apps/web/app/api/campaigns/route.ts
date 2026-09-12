import { and, count, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { schema } from "@wa/db";
import type { CampaignVariableBinding } from "@wa/queue";
import { getAuthContext } from "@/lib/auth-context";
import { campaignDispatchQueue, db } from "@/lib/server";

export const runtime = "nodejs";

const bindingSchema = z.object({
  index: z.number().int().positive().max(20),
  source: z.enum(["display_name", "phone_e164", "literal"]),
  value: z.string().trim().max(500).optional(),
  fallback: z.string().trim().max(120).optional(),
}).superRefine((binding, context) => {
  if (binding.source === "literal" && !binding.value?.trim()) {
    context.addIssue({ code: "custom", message: "Literal template variables need a value" });
  }
});

const createCampaignSchema = z.object({
  name: z.string().trim().min(2).max(120),
  whatsappPhoneNumberId: z.uuid(),
  templateId: z.uuid(),
  bindings: z.array(bindingSchema).max(20).default([]),
});

function requiredVariableIndexes(body: string | null): number[] {
  if (!body) return [];
  return [...new Set([...body.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1])))]
    .filter((value) => Number.isInteger(value) && value > 0)
    .sort((a, b) => a - b);
}

function isTextOnlyTemplate(components: unknown): boolean {
  if (!Array.isArray(components)) return true;
  return components.every((component) => {
    if (!component || typeof component !== "object") return false;
    const type = String((component as Record<string, unknown>).type ?? "").toUpperCase();
    return type === "BODY" || type === "FOOTER";
  });
}

export async function POST(request: Request) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = createCampaignSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid campaign request", issues: parsed.error.issues }, { status: 400 });
  }

  const organizationId = context.workspace.organizationId;
  const [phone, template] = await Promise.all([
    db.select().from(schema.whatsappPhoneNumbers)
      .where(and(
        eq(schema.whatsappPhoneNumbers.id, parsed.data.whatsappPhoneNumberId),
        eq(schema.whatsappPhoneNumbers.organizationId, organizationId),
        eq(schema.whatsappPhoneNumbers.status, "connected"),
      ))
      .limit(1)
      .then((rows) => rows[0]),
    db.select().from(schema.templates)
      .where(and(
        eq(schema.templates.id, parsed.data.templateId),
        eq(schema.templates.organizationId, organizationId),
        eq(schema.templates.status, "approved"),
      ))
      .limit(1)
      .then((rows) => rows[0]),
  ]);

  if (!phone) return NextResponse.json({ error: "Choose a connected WhatsApp number" }, { status: 400 });
  if (!template) return NextResponse.json({ error: "Choose an approved template" }, { status: 400 });
  if (phone.wabaId !== template.wabaId) {
    return NextResponse.json({ error: "The selected template belongs to a different WhatsApp Business Account" }, { status: 400 });
  }
  if (!isTextOnlyTemplate(template.components)) {
    return NextResponse.json({ error: "This first campaign engine supports text/body templates only. Sync or create a text template for this campaign." }, { status: 400 });
  }

  const required = requiredVariableIndexes(template.bodyPreview);
  const bindings = parsed.data.bindings as CampaignVariableBinding[];
  const supplied = [...new Set(bindings.map((binding) => binding.index))].sort((a, b) => a - b);
  if (required.length !== supplied.length || required.some((value, index) => value !== supplied[index])) {
    return NextResponse.json({ error: `Template variables must be mapped exactly: ${required.map((value) => `{{${value}}}`).join(", ") || "none"}` }, { status: 400 });
  }

  const [eligibleRow] = await db
    .select({ total: count() })
    .from(schema.contacts)
    .where(and(
      eq(schema.contacts.organizationId, organizationId),
      eq(schema.contacts.optedIn, true),
      isNull(schema.contacts.unsubscribedAt),
    ));
  const eligibleContacts = eligibleRow?.total ?? 0;
  if (eligibleContacts === 0) {
    return NextResponse.json({ error: "There are no opted-in, non-unsubscribed contacts to send to" }, { status: 400 });
  }

  const [campaign] = await db
    .insert(schema.campaigns)
    .values({
      organizationId,
      whatsappPhoneNumberId: phone.id,
      templateId: template.id,
      name: parsed.data.name,
      status: "dispatching",
      templateBindings: bindings,
    })
    .returning({ id: schema.campaigns.id });

  if (!campaign) return NextResponse.json({ error: "Could not create campaign" }, { status: 500 });

  try {
    await campaignDispatchQueue.add(
      "dispatch-campaign",
      { organizationId, campaignId: campaign.id },
      { jobId: `campaign-${campaign.id}` },
    );
  } catch (error) {
    await db.update(schema.campaigns)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(schema.campaigns.id, campaign.id));
    console.error("Could not queue campaign dispatcher", error);
    return NextResponse.json({ error: "Campaign was created but could not be queued" }, { status: 503 });
  }

  return NextResponse.json({
    campaignId: campaign.id,
    status: "dispatching",
    eligibleContacts,
    throughputMps: phone.throughputMps,
    estimatedSeconds: Math.ceil(eligibleContacts / Math.max(1, Math.floor(phone.throughputMps * 0.95))),
  }, { status: 201 });
}
