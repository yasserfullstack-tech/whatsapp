import { parse } from "csv-parse";
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";

export type CsvRow = Record<string, string | undefined>;
export type ContactImportMapping = {
  phone_column: string;
  display_name_column: string | null;
  custom_fields: Record<string, string> | null;
};

export const PHONE_COLUMNS = ["phone", "phone_number", "mobile", "mobile_number", "whatsapp", "whatsapp_number"];
export const NAME_COLUMNS = ["name", "full_name", "customer_name", "display_name"];
export const MAX_IMPORT_ROWS = 2_000_000;
export const INSERT_BATCH_SIZE = 1_000;
export const PROGRESS_CHECKPOINT_ROWS = 5_000;

export function createContactCsvParser() {
  return parse({
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    max_record_size: 1024 * 1024,
  });
}

export function normalizeColumns(row: CsvRow): CsvRow {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.trim().toLowerCase().replace(/[\s-]+/g, "_"),
      typeof value === "string" ? value.trim() : value,
    ]),
  );
}

export function firstValue(row: CsvRow, columns: string[]): string | undefined {
  for (const column of columns) {
    const value = row[column];
    if (value) return value;
  }
  return undefined;
}

export function normalizePhone(value: string, country: CountryCode): string | null {
  const cleaned = value.trim().replace(/^'/, "");
  const parsed = parsePhoneNumberFromString(cleaned, country);
  if (!parsed || !parsed.isPossible() || !parsed.isValid()) return null;
  return parsed.number;
}
