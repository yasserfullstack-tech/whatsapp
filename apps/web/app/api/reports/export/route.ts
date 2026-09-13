import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { getI18n } from "@/lib/i18n/server";
import { parseReportFilters, toCsv, type ReportKind } from "@/lib/reporting-core";
import { getReportRows, getReportingTimezone, type AudienceReportRow, type CampaignReportRow, type PhoneReportRow, type TemplateReportRow } from "@/lib/reporting";

export const runtime = "nodejs";

function reportKind(value: string | null): ReportKind | null {
  return value === "campaigns" || value === "templates" || value === "audiences" || value === "phone-numbers" ? value : null;
}

function csvData(kind: ReportKind, rows: Awaited<ReturnType<typeof getReportRows>>["rows"]) {
  if (kind === "campaigns") {
    return {
      headers: ["Campaign", "Audience size", "Accepted", "Delivered", "Read", "Failed", "Opt-outs", "Delivery %", "Read %", "Failure %"],
      rows: (rows as CampaignReportRow[]).map((row) => [row.name, row.audienceSize, row.accepted, row.delivered, row.read, row.failed, row.optOuts, (row.deliveryRate * 100).toFixed(1), (row.readRate * 100).toFixed(1), (row.failureRate * 100).toFixed(1)]),
    };
  }
  if (kind === "templates") {
    return {
      headers: ["Template", "Language", "Campaigns", "Recipients", "Delivered", "Read", "Failed", "Delivery %", "Read %", "Failure %"],
      rows: (rows as TemplateReportRow[]).map((row) => [row.name, row.language, row.campaigns, row.recipients, row.delivered, row.read, row.failed, (row.deliveryRate * 100).toFixed(1), (row.readRate * 100).toFixed(1), (row.failureRate * 100).toFixed(1)]),
    };
  }
  if (kind === "audiences") {
    return {
      headers: ["Audience", "Type", "Campaigns", "Recipients", "Delivered", "Read", "Failed", "Delivery %", "Read %", "Failure %"],
      rows: (rows as AudienceReportRow[]).map((row) => [row.name, row.type, row.campaigns, row.recipients, row.delivered, row.read, row.failed, (row.deliveryRate * 100).toFixed(1), (row.readRate * 100).toFixed(1), (row.failureRate * 100).toFixed(1)]),
    };
  }
  return {
    headers: ["Phone number", "Campaigns", "Submitted", "Delivered", "Failed", "Quality", "Throughput MPS", "Delivery %", "Failure %"],
    rows: (rows as PhoneReportRow[]).map((row) => [row.number, row.campaigns, row.submitted, row.delivered, row.failed, row.quality, row.throughput, (row.deliveryRate * 100).toFixed(1), (row.failureRate * 100).toFixed(1)]),
  };
}

export async function GET(request: Request) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const kind = reportKind(url.searchParams.get("report"));
  if (!kind) return NextResponse.json({ error: "Invalid report type" }, { status: 400 });

  const organizationId = context.workspace.organizationId;
  const timezone = await getReportingTimezone(organizationId);
  const filters = parseReportFilters(Object.fromEntries(url.searchParams.entries()), timezone);
  const { rows, total } = await getReportRows(kind, organizationId, filters, timezone, 50_000);
  if (total > 50_000) {
    return NextResponse.json({ error: "This export is larger than 50,000 report rows. Narrow the filters and try again." }, { status: 413 });
  }

  const { locale } = await getI18n();
  const data = csvData(kind, rows);
  const csv = toCsv(data.headers, data.rows);
  const filename = `reports-${kind}-${filters.fromDate}-${filters.toDate}-${locale}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store, max-age=0",
      "x-content-type-options": "nosniff",
    },
  });
}
