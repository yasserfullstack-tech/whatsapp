import { z } from "zod";

export const E164_RE = /^\+[1-9]\d{7,14}$/;
const FIELD_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_.-]{0,39}$/;

const rawTagsSchema = z.array(z.string().trim().min(1).max(40)).max(20);
const rawCustomFieldsSchema = z
  .record(z.string().trim().regex(FIELD_KEY_RE), z.string().trim().max(500))
  .refine((value) => Object.keys(value).length <= 20, "A contact can have at most 20 custom fields");

export const tagsSchema = rawTagsSchema.default([]);
export const customFieldsSchema = rawCustomFieldsSchema.default({});

export const createContactSchema = z.object({
  phoneE164: z.string().trim().regex(E164_RE, "Phone must be E.164, for example +15551234567"),
  displayName: z.string().trim().max(160).nullable().optional(),
  tags: tagsSchema,
  customFields: customFieldsSchema,
  note: z.string().trim().min(1).max(4_000).optional(),
});

export const updateContactSchema = z.object({
  displayName: z.string().trim().max(160).nullable().optional(),
  tags: rawTagsSchema.optional(),
  customFields: rawCustomFieldsSchema.optional(),
  note: z.string().trim().min(1).max(4_000).optional(),
}).refine((value) => Object.values(value).some((item) => item !== undefined), "At least one change is required");

export const bulkContactSchema = z.object({
  contactIds: z.array(z.string().uuid()).min(1).max(100).transform((ids) => [...new Set(ids)]),
  action: z.enum(["add_tag", "remove_tag", "suppress"]),
  tag: z.string().trim().min(1).max(40).optional(),
  reason: z.string().trim().min(3).max(240).optional(),
}).superRefine((value, context) => {
  if ((value.action === "add_tag" || value.action === "remove_tag") && !value.tag) {
    context.addIssue({ code: "custom", path: ["tag"], message: "A tag is required for tag bulk actions" });
  }
});

export const mergeContactSchema = z.object({
  targetContactId: z.string().uuid(),
  sourceContactIds: z.array(z.string().uuid()).min(1).max(20).transform((ids) => [...new Set(ids)]),
  reason: z.string().trim().min(3).max(240).optional(),
}).superRefine((value, context) => {
  if (value.sourceContactIds.includes(value.targetContactId)) {
    context.addIssue({ code: "custom", path: ["sourceContactIds"], message: "Target contact cannot also be a merge source" });
  }
});

export function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 20);
}

export function normalizeCustomFields(fields: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fields)
      .map(([key, value]) => [key.trim(), value.trim()] as const)
      .filter(([, value]) => value.length > 0)
      .slice(0, 20),
  );
}

/**
 * Drizzle wraps driver failures in `DrizzleQueryError`, so the Postgres error
 * code lives on the `cause` chain rather than on the thrown error itself.
 * Walking the chain keeps duplicate-phone and duplicate-merge handling on the
 * intended 409 path instead of surfacing a 500.
 */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    if ((current as { code?: string }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
