import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  buildEligibleAudiencePredicate,
  schema,
  type AudienceFilter,
  type CampaignAudienceDefinition,
} from "@wa/db";
import { db } from "@/lib/server";

const displayNameFilterSchema = z.object({
  field: z.literal("display_name"),
  operator: z.enum(["contains", "starts_with", "equals", "is_empty"]),
  value: z.string().trim().max(120).optional(),
}).superRefine((filter, context) => {
  if (filter.operator !== "is_empty" && !filter.value?.trim()) {
    context.addIssue({ code: "custom", message: "Name filters need a value" });
  }
});

export const audienceFilterSchema = z.discriminatedUnion("field", [
  z.object({ field: z.literal("list"), operator: z.literal("in"), value: z.uuid() }),
  displayNameFilterSchema,
  z.object({
    field: z.literal("phone_e164"),
    operator: z.enum(["starts_with", "ends_with", "equals"]),
    value: z.string().trim().min(2).max(32),
  }),
]);

export const segmentDefinitionSchema = z.object({
  match: z.enum(["all", "any"]),
  filters: z.array(audienceFilterSchema).min(1).max(20),
});

export const audienceSelectionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("all") }),
  z.object({ type: z.literal("list"), id: z.uuid() }),
  z.object({ type: z.literal("segment"), id: z.uuid() }),
]);

async function ensureListFiltersBelongToOrganization(organizationId: string, filters: AudienceFilter[]): Promise<void> {
  const listIds = [...new Set(filters.filter((filter) => filter.field === "list").map((filter) => filter.value))];
  if (!listIds.length) return;

  const rows = await db
    .select({ id: schema.contactLists.id })
    .from(schema.contactLists)
    .where(and(
      eq(schema.contactLists.organizationId, organizationId),
      inArray(schema.contactLists.id, listIds),
    ));

  if (rows.length !== listIds.length) throw new Error("One or more audience lists are unavailable in this workspace");
}

export async function validateSegmentDefinition(organizationId: string, input: unknown) {
  const parsed = segmentDefinitionSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, issues: parsed.error.issues };
  await ensureListFiltersBelongToOrganization(organizationId, parsed.data.filters);
  return { ok: true as const, definition: parsed.data };
}

export async function resolveAudienceSelection(organizationId: string, input: unknown): Promise<{
  definition: CampaignAudienceDefinition;
  sourceId: string | null;
  sourceName: string;
}> {
  const parsed = audienceSelectionSchema.safeParse(input);
  if (!parsed.success) throw new Error("Choose a valid audience");

  if (parsed.data.type === "all") {
    return { definition: { type: "all" }, sourceId: null, sourceName: "All eligible contacts" };
  }

  if (parsed.data.type === "list") {
    const [list] = await db
      .select({ id: schema.contactLists.id, name: schema.contactLists.name })
      .from(schema.contactLists)
      .where(and(eq(schema.contactLists.id, parsed.data.id), eq(schema.contactLists.organizationId, organizationId)))
      .limit(1);
    if (!list) throw new Error("Audience list not found");
    return { definition: { type: "list", listId: list.id }, sourceId: list.id, sourceName: list.name };
  }

  const [segment] = await db
    .select({ id: schema.audienceSegments.id, name: schema.audienceSegments.name, match: schema.audienceSegments.match, filters: schema.audienceSegments.filters })
    .from(schema.audienceSegments)
    .where(and(eq(schema.audienceSegments.id, parsed.data.id), eq(schema.audienceSegments.organizationId, organizationId)))
    .limit(1);
  if (!segment) throw new Error("Audience segment not found");
  await ensureListFiltersBelongToOrganization(organizationId, segment.filters);
  return {
    definition: { type: "segment", match: segment.match, filters: segment.filters },
    sourceId: segment.id,
    sourceName: segment.name,
  };
}

export async function countEligibleAudience(organizationId: string, definition: CampaignAudienceDefinition): Promise<number> {
  const predicate = buildEligibleAudiencePredicate(definition, organizationId);
  const rows = await db.execute(sql`SELECT COUNT(*)::int AS total FROM contacts c WHERE ${predicate}`);
  const first = (rows as unknown as Array<{ total?: number | string }>)[0];
  return Number(first?.total ?? 0);
}

export async function sampleEligibleAudience(organizationId: string, definition: CampaignAudienceDefinition) {
  const predicate = buildEligibleAudiencePredicate(definition, organizationId);
  const rows = await db.execute(sql`
    SELECT c.id, c.display_name, c.phone_e164
    FROM contacts c
    WHERE ${predicate}
    ORDER BY c.created_at DESC, c.id
    LIMIT 10
  `);
  return (rows as unknown as Array<{ id: string; display_name: string | null; phone_e164: string }>).map((row) => ({
    id: row.id,
    displayName: row.display_name,
    phoneE164: row.phone_e164,
  }));
}
