import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { schema } from "@wa/db";
import { validateTemplateBindings, type TemplateParameterBinding } from "@wa/meta/templates";
import { getAuthContext } from "@/lib/auth-context";
import {
  audienceSelectionSchema,
  countEligibleAudience,
  resolveAudienceSelection,
} from "@/lib/audience-server";
import { entitlements, entitlementErrorPayload } from "@/lib/entitlements-server";
import { campaignDispatchQueue, db } from "@/lib/server";
import { can } from "@/lib/workspace-access";

export const runtime = "nodejs";

const bindingSchema = z.object({
  key: z.string().trim().min(1).max(128).optional(),
  index: z.number().int().positive().max(20),
  component: z.enum(["header", "body", "button"]).optional(),
  parameterType: z.enum(["text", "image", "video", "document", "payload"]).optional(),
  buttonIndex: z.number().int().min(0).max(9).optional(),
  buttonSubType: z.enum(["url", "quick_reply"]).optional(),
  source: z.enum(["display_name", "phone_e164", "literal"]),
  value: z.string().trim().max(2_000).optional(),
  fallback: z.string().trim().max(120).optional(),
}).superRefine((binding, context) => {
  if (binding.source === "literal" && !binding.value?.trim()) {
    context.addIssue({ code: "custom", message: "Literal template parameters need a value" });
  }
  if (binding.source === "display_name" && !binding.fallback?.trim()) {
    context.addIssue({ code: "custom", message: "Contact-name template parameters need an explicit fallback" });
  }
});

const createCampaignSchema = z.object({
  name: z.string().trim().min(2).max(120),
  whatsappPhoneNumberId: z.uuid(),
  templateId: z.uuid(),
  audience: audienceSelectionSchema,
  bindings: z.array(bindingSchema).max(30).default([]),
});

export async function POST(request: Request) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(context.workspace.role, "campaigns.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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

  const validation = validateTemplateBindings(template.components, parsed.data.bindings as TemplateParameterBinding[]);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.errors.join(". "), issues: validation.errors }, { status: 400 });
  }
  const bindings = validation.normalizedBindings;

  let audience;
  try {
    audience = await resolveAudienceSelection(organizationId, parsed.data.audience);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Choose a valid audience" }, { status: 400 });
  }

  const eligibleContacts = await countEligibleAudience(organizationId, audience.definition);
  if (eligibleContacts === 0) {
    return NextResponse.json({ error: "The selected audience has no currently eligible, non-suppressed contacts" }, { status: 400 });
  }

  try {
    // This is an early UX check only. The worker records the authoritative
    // billable event immediately before the provider send boundary.
    await entitlements.assertUsage(organizationId, "monthly_campaign_recipients", {
      requested: eligibleContacts,
    });
  } catch (error) {
    const payload = entitlementErrorPayload(error);
    if (payload) return NextResponse.json(payload, { status: 409 });
    throw error;
  }

  const campaignId = await db.transaction(async (tx) => {
    const [campaign] = await tx
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

    if (!campaign) throw new Error("Could not create campaign");

    await tx.insert(schema.campaignAudiences).values({
      organizationId,
      campaignId: campaign.id,
      type: audience.definition.type,
      sourceId: audience.sourceId,
      sourceName: audience.sourceName,
      definition: audience.definition,
    });

    return campaign.id;
  });

  try {
    await campaignDispatchQueue.add(
      "dispatch-campaign",
      { organizationId, campaignId },
      { jobId: `campaign-${campaignId}` },
    );
  } catch (error) {
    await db.update(schema.campaigns)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(schema.campaigns.id, campaignId));
    console.error("Could not queue campaign dispatcher", error);
    return NextResponse.json({ error: "Campaign was created but could not be queued" }, { status: 503 });
  }

  return NextResponse.json({
    campaignId,
    status: "dispatching",
    audienceName: audience.sourceName,
    eligibleContacts,
    throughputMps: phone.throughputMps,
    estimatedSeconds: Math.ceil(eligibleContacts / Math.max(1, Math.floor(phone.throughputMps * 0.95))),
  }, { status: 201 });
}
