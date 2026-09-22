import { describe, expect, test } from "bun:test";
import {
  bulkContactSchema,
  createContactSchema,
  isUniqueViolation,
  mergeContactSchema,
  normalizeCustomFields,
  normalizeTags,
  updateContactSchema,
} from "./contact-management";

const CONTACT_A = "11111111-1111-4111-8111-111111111111";
const CONTACT_B = "22222222-2222-4222-8222-222222222222";

 describe("contact management validation", () => {
  test("manual creation requires canonical E.164 and starts from validated metadata", () => {
    expect(createContactSchema.safeParse({ phoneE164: "07701234567", tags: [], customFields: {} }).success).toBe(false);
    expect(createContactSchema.safeParse({ phoneE164: "+9647701234567", tags: ["vip"], customFields: { company: "Acme" } }).success).toBe(true);
  });

  test("updates require an actual change", () => {
    expect(updateContactSchema.safeParse({}).success).toBe(false);
    expect(updateContactSchema.safeParse({ displayName: "Ada" }).success).toBe(true);
  });

  test("bulk actions deduplicate ids and require tag input for tag actions", () => {
    const parsed = bulkContactSchema.safeParse({ contactIds: [CONTACT_A, CONTACT_A], action: "add_tag", tag: "vip" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.contactIds).toEqual([CONTACT_A]);
    expect(bulkContactSchema.safeParse({ contactIds: [CONTACT_A], action: "remove_tag" }).success).toBe(false);
  });

  test("merge validation forbids using the target as a source", () => {
    expect(mergeContactSchema.safeParse({ targetContactId: CONTACT_A, sourceContactIds: [CONTACT_A] }).success).toBe(false);
    expect(mergeContactSchema.safeParse({ targetContactId: CONTACT_A, sourceContactIds: [CONTACT_B] }).success).toBe(true);
  });

  test("metadata normalization removes duplicates, blanks, and empty custom values", () => {
    expect(normalizeTags([" vip ", "vip", "customer", ""])).toEqual(["vip", "customer"]);
    expect(normalizeCustomFields({ company: " Acme ", empty: " " })).toEqual({ company: "Acme" });
  });

  test("unique violations are detected through the Drizzle error wrapper", () => {
    // The live driver error is nested inside DrizzleQueryError.cause, so the
    // route would otherwise report a 500 instead of the intended 409.
    const driverError = Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
    const wrapped = Object.assign(new Error("Failed query: insert into \"contacts\""), { cause: driverError });
    expect(isUniqueViolation(wrapped)).toBe(true);
    expect(isUniqueViolation(driverError)).toBe(true);

    const other = Object.assign(new Error("Failed query"), { cause: Object.assign(new Error("nope"), { code: "23503" }) });
    expect(isUniqueViolation(other)).toBe(false);
    expect(isUniqueViolation(new Error("plain failure"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });

  test("unique-violation detection terminates on a cyclic cause chain", () => {
    const cyclic = Object.assign(new Error("cycle"), { code: "42601" }) as Error & { cause?: unknown };
    cyclic.cause = cyclic;
    expect(isUniqueViolation(cyclic)).toBe(false);
  });
});
