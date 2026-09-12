import { sql, type SQL } from "drizzle-orm";
import type { AudienceFilter, CampaignAudienceDefinition } from "./audience-schema";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function filterPredicate(filter: AudienceFilter, organizationId: string): SQL {
  if (filter.field === "list") {
    return sql`EXISTS (
      SELECT 1
      FROM contact_list_members clm
      WHERE clm.organization_id = ${organizationId}::uuid
        AND clm.contact_id = c.id
        AND clm.list_id = ${filter.value}::uuid
    )`;
  }

  if (filter.field === "display_name") {
    if (filter.operator === "is_empty") return sql`COALESCE(BTRIM(c.display_name), '') = ''`;
    const value = escapeLike(filter.value ?? "");
    if (filter.operator === "equals") return sql`LOWER(COALESCE(c.display_name, '')) = LOWER(${filter.value ?? ""})`;
    if (filter.operator === "starts_with") return sql`COALESCE(c.display_name, '') ILIKE ${`${value}%`} ESCAPE '\\'`;
    return sql`COALESCE(c.display_name, '') ILIKE ${`%${value}%`} ESCAPE '\\'`;
  }

  if (filter.operator === "equals") return sql`c.phone_e164 = ${filter.value}`;
  const value = escapeLike(filter.value);
  if (filter.operator === "ends_with") return sql`c.phone_e164 LIKE ${`%${value}`} ESCAPE '\\'`;
  return sql`c.phone_e164 LIKE ${`${value}%`} ESCAPE '\\'`;
}

export function normalizeAudienceDefinition(value: unknown): CampaignAudienceDefinition {
  if (!value || typeof value !== "object") return { type: "all" };
  const candidate = value as Record<string, unknown>;
  if (candidate.type === "all") return { type: "all" };

  if (candidate.type === "list" && typeof candidate.listId === "string" && UUID_RE.test(candidate.listId)) {
    return { type: "list", listId: candidate.listId };
  }

  if (candidate.type !== "segment" || (candidate.match !== "all" && candidate.match !== "any") || !Array.isArray(candidate.filters)) {
    return { type: "all" };
  }

  const filters: AudienceFilter[] = [];
  for (const item of candidate.filters.slice(0, 20)) {
    if (!item || typeof item !== "object") continue;
    const filter = item as Record<string, unknown>;

    if (filter.field === "list" && filter.operator === "in" && typeof filter.value === "string" && UUID_RE.test(filter.value)) {
      filters.push({ field: "list", operator: "in", value: filter.value });
      continue;
    }

    if (filter.field === "display_name" && ["contains", "starts_with", "equals", "is_empty"].includes(String(filter.operator))) {
      const operator = filter.operator as "contains" | "starts_with" | "equals" | "is_empty";
      if (operator === "is_empty") {
        filters.push({ field: "display_name", operator });
      } else if (typeof filter.value === "string" && filter.value.trim()) {
        filters.push({ field: "display_name", operator, value: filter.value.trim().slice(0, 120) });
      }
      continue;
    }

    if (filter.field === "phone_e164" && ["starts_with", "ends_with", "equals"].includes(String(filter.operator)) && typeof filter.value === "string" && filter.value.trim()) {
      filters.push({
        field: "phone_e164",
        operator: filter.operator as "starts_with" | "ends_with" | "equals",
        value: filter.value.trim().slice(0, 32),
      });
    }
  }

  if (!filters.length) return { type: "all" };
  return { type: "segment", match: candidate.match, filters };
}

export function buildEligibleAudiencePredicate(definition: CampaignAudienceDefinition, organizationId: string): SQL {
  const safetyPredicates: SQL[] = [
    sql`c.organization_id = ${organizationId}::uuid`,
    sql`c.opted_in = true`,
    sql`c.unsubscribed_at IS NULL`,
    sql`NOT EXISTS (
      SELECT 1
      FROM suppression_list sl
      WHERE sl.organization_id = ${organizationId}::uuid
        AND sl.phone_e164 = c.phone_e164
    )`,
  ];

  let audiencePredicate: SQL | null = null;
  if (definition.type === "list") {
    audiencePredicate = filterPredicate({ field: "list", operator: "in", value: definition.listId }, organizationId);
  } else if (definition.type === "segment") {
    const filters = definition.filters.map((filter) => filterPredicate(filter, organizationId));
    if (filters.length) {
      audiencePredicate = definition.match === "any"
        ? sql`(${sql.join(filters, sql` OR `)})`
        : sql`(${sql.join(filters, sql` AND `)})`;
    }
  }

  return audiencePredicate
    ? sql`${sql.join([...safetyPredicates, audiencePredicate], sql` AND `)}`
    : sql`${sql.join(safetyPredicates, sql` AND `)}`;
}
