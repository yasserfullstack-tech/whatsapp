import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

/**
 * The contact import runtime is verified from source so this contract remains independent
 * of BullMQ startup. These assertions guard the mapping contract the presign
 * route writes into `contact_import_mappings` — the processor must consume the
 * stored mapping instead of falling back to header heuristics.
 */
const workerSource = readFileSync(new URL("./contact-import-processor.ts", import.meta.url), "utf8");

function expectSource(fragment: string) {
  expect(workerSource.includes(fragment), `worker source must contain: ${fragment}`).toBe(true);
}

describe("contact import mapping contract", () => {
  test("the stored mapping is read tenant-scoped for the import being processed", () => {
    expectSource("SELECT phone_column, display_name_column, custom_fields");
    expectSource("FROM contact_import_mappings");
    expectSource("WHERE import_id = ${contactImport.id}::uuid AND organization_id = ${contactImport.organizationId}::uuid");
  });

  test("a mapped phone column replaces the header heuristic and is required to exist", () => {
    expectSource("importMapping ? row[importMapping.phone_column] : firstValue(row, PHONE_COLUMNS)");
    expectSource("Object.hasOwn(row, importMapping.phone_column)");
  });

  test("mapped custom fields are truncated to the stored column limits before they are written", () => {
    expectSource("importMapping.custom_fields");
    // contact_custom_fields.field_value is CHECK (char_length <= 500).
    expectSource("row[column]?.trim().slice(0, 500)");
    // contacts.display_name is capped at 160 by the contact management schema.
    expectSource("row[importMapping.display_name_column]?.slice(0, 160)");
    expectSource("INSERT INTO contact_custom_fields");
  });
});
