import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { describe, expect, test } from "bun:test";
import { parse } from "csv-parse";

const workerSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

const parserOptions = {
  bom: true,
  columns: true,
  skip_empty_lines: true,
  trim: true,
  relax_column_count: true,
  max_record_size: 1024 * 1024,
} as const;

async function parseRows(csv: string): Promise<Array<Record<string, string>>> {
  const parser = parse(parserOptions);
  Readable.from([csv]).pipe(parser);
  const rows: Array<Record<string, string>> = [];
  for await (const row of parser) rows.push(row as Record<string, string>);
  return rows;
}

describe("contact import CSV security policy", () => {
  test("the live worker keeps parser and row safety limits enabled", () => {
    expect(workerSource).toContain("max_record_size: 1024 * 1024");
    expect(workerSource).toContain("const MAX_IMPORT_ROWS = 2_000_000");
    expect(workerSource).toContain("if (seenRows > MAX_IMPORT_ROWS)");
    expect(workerSource).toContain("CSV needs a phone column");
    expect(workerSource).toContain("parsePhoneNumberFromString(cleaned, country)");
  });

  test("oversized individual records are rejected by the configured parser", async () => {
    const oversized = `phone,name\n+15551234567,${"A".repeat(1024 * 1024 + 1)}\n`;
    await expect(parseRows(oversized)).rejects.toThrow();
  });

  test("malformed quoted CSV fails instead of silently becoming trusted rows", async () => {
    await expect(parseRows('phone,name\n"+15551234567,Alice\n')).rejects.toThrow();
  });

  test("column-name tricks remain data and do not create executable structure", async () => {
    const rows = await parseRows(
      ' Phone Number , Display-Name ,extra\n"+15551234567","=HYPERLINK(\"\"https://evil.invalid\"\",\"\"x\"\")","%27 OR 1=1 --"\n',
    );
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.[" Phone Number "]).toBe("+15551234567");
    expect(row?.[" Display-Name "]).toContain("HYPERLINK");
    expect(row?.extra).toBe("%27 OR 1=1 --");
  });

  test("BOM and blank lines do not manufacture extra import records", async () => {
    const rows = await parseRows("\uFEFFphone,name\n\n+15551234567,Alice\n\n");
    expect(rows).toEqual([{ phone: "+15551234567", name: "Alice" }]);
  });
});
