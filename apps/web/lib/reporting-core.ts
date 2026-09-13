export type ReportRange = "today" | "7d" | "30d" | "custom";
export type ReportKind = "campaigns" | "templates" | "audiences" | "phone-numbers";

export type ReportFilters = {
  range: ReportRange;
  fromDate: string;
  toDate: string;
  phoneNumberId?: string;
  campaignId?: string;
  templateId?: string;
  page: number;
};

type SearchInput = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function validDate(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
}

export function validUuid(value: string | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

function dateInTimezone(now: Date, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

function addDays(date: string, amount: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

export function parseReportFilters(input: SearchInput, timezone: string, now = new Date()): ReportFilters {
  const requestedRange = single(input.range);
  const range: ReportRange = requestedRange === "today" || requestedRange === "7d" || requestedRange === "custom" ? requestedRange : "30d";
  const today = dateInTimezone(now, timezone);

  let fromDate = range === "today" ? today : addDays(today, range === "7d" ? -6 : -29);
  let toDate = today;

  if (range === "custom") {
    const requestedFrom = single(input.from);
    const requestedTo = single(input.to);
    fromDate = validDate(requestedFrom) ? requestedFrom : addDays(today, -29);
    toDate = validDate(requestedTo) ? requestedTo : today;
    if (fromDate > toDate) [fromDate, toDate] = [toDate, fromDate];
  }

  const pageValue = Number.parseInt(single(input.page) ?? "1", 10);
  const page = Number.isFinite(pageValue) && pageValue > 0 ? Math.min(pageValue, 10_000) : 1;
  const phoneNumberId = single(input.phone);
  const campaignId = single(input.campaign);
  const templateId = single(input.template);

  return {
    range,
    fromDate,
    toDate,
    page,
    ...(validUuid(phoneNumberId) ? { phoneNumberId } : {}),
    ...(validUuid(campaignId) ? { campaignId } : {}),
    ...(validUuid(templateId) ? { templateId } : {}),
  };
}

export function ratio(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return Math.max(0, numerator / denominator);
}

export function percent(value: number): string {
  return `${(Math.max(0, Math.min(1, value)) * 100).toFixed(1)}%`;
}

function escapeCsvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return `\uFEFF${[headers, ...rows].map((row) => row.map(escapeCsvCell).join(",")).join("\r\n")}\r\n`;
}

export function filtersToSearchParams(filters: ReportFilters, includePage = true): URLSearchParams {
  const params = new URLSearchParams({ range: filters.range });
  if (filters.range === "custom") {
    params.set("from", filters.fromDate);
    params.set("to", filters.toDate);
  }
  if (filters.phoneNumberId) params.set("phone", filters.phoneNumberId);
  if (filters.campaignId) params.set("campaign", filters.campaignId);
  if (filters.templateId) params.set("template", filters.templateId);
  if (includePage && filters.page > 1) params.set("page", String(filters.page));
  return params;
}
