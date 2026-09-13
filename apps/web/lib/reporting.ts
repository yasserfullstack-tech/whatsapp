import { desc, eq, sql, type SQL } from "drizzle-orm";
import { schema } from "@wa/db";
import { db } from "./server";
import { ratio, type ReportFilters, type ReportKind } from "./reporting-core";

export type ReportSummary = {
  campaigns: number;
  recipients: number;
  submitted: number;
  accepted: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  skipped: number;
  optOuts: number;
  rates: {
    acceptance: number;
    delivery: number;
    read: number;
    failure: number;
    optOut: number;
  };
};

export type ReportSeriesPoint = {
  day: string;
  submitted: number;
  delivered: number;
  read: number;
  failed: number;
  optOuts: number;
};

export type ReportFilterOptions = {
  campaigns: Array<{ id: string; name: string }>;
  templates: Array<{ id: string; name: string }>;
  phoneNumbers: Array<{ id: string; label: string }>;
};

export type CampaignReportRow = {
  id: string;
  name: string;
  audienceSize: number;
  accepted: number;
  delivered: number;
  read: number;
  failed: number;
  optOuts: number;
  deliveryRate: number;
  readRate: number;
  failureRate: number;
};

export type TemplateReportRow = {
  id: string;
  name: string;
  language: string;
  campaigns: number;
  recipients: number;
  delivered: number;
  read: number;
  failed: number;
  deliveryRate: number;
  readRate: number;
  failureRate: number;
};

export type AudienceReportRow = {
  key: string;
  name: string;
  type: string;
  campaigns: number;
  recipients: number;
  delivered: number;
  read: number;
  failed: number;
  deliveryRate: number;
  readRate: number;
  failureRate: number;
};

export type PhoneReportRow = {
  id: string;
  number: string;
  campaigns: number;
  submitted: number;
  delivered: number;
  failed: number;
  quality: string;
  throughput: number;
  deliveryRate: number;
  failureRate: number;
};

export type ReportRows = CampaignReportRow[] | TemplateReportRow[] | AudienceReportRow[] | PhoneReportRow[];
export type PagedReportRows = { rows: ReportRows; total: number };

function resultRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as T[];
  }
  return [];
}

function numberValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function campaignWhere(organizationId: string, filters: ReportFilters, timezone: string): SQL {
  const conditions: SQL[] = [
    sql`c.organization_id = ${organizationId}::uuid`,
    sql`(c.created_at AT TIME ZONE ${timezone})::date BETWEEN ${filters.fromDate}::date AND ${filters.toDate}::date`,
  ];
  if (filters.phoneNumberId) conditions.push(sql`c.whatsapp_phone_number_id = ${filters.phoneNumberId}::uuid`);
  if (filters.campaignId) conditions.push(sql`c.id = ${filters.campaignId}::uuid`);
  if (filters.templateId) conditions.push(sql`c.template_id = ${filters.templateId}::uuid`);
  return sql.join(conditions, sql` AND `);
}

export async function getReportingTimezone(organizationId: string): Promise<string> {
  const [preferences] = await db
    .select({ timezone: schema.workspacePreferences.timezone })
    .from(schema.workspacePreferences)
    .where(eq(schema.workspacePreferences.organizationId, organizationId))
    .limit(1);
  return preferences?.timezone || "UTC";
}

export async function getReportFilterOptions(organizationId: string): Promise<ReportFilterOptions> {
  const [campaigns, templates, phoneNumbers] = await Promise.all([
    db.select({ id: schema.campaigns.id, name: schema.campaigns.name })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.organizationId, organizationId))
      .orderBy(desc(schema.campaigns.createdAt))
      .limit(500),
    db.select({ id: schema.templates.id, name: schema.templates.name })
      .from(schema.templates)
      .where(eq(schema.templates.organizationId, organizationId))
      .orderBy(desc(schema.templates.updatedAt))
      .limit(500),
    db.select({ id: schema.whatsappPhoneNumbers.id, display: schema.whatsappPhoneNumbers.displayPhoneNumber, verifiedName: schema.whatsappPhoneNumbers.verifiedName })
      .from(schema.whatsappPhoneNumbers)
      .where(eq(schema.whatsappPhoneNumbers.organizationId, organizationId))
      .orderBy(desc(schema.whatsappPhoneNumbers.updatedAt))
      .limit(200),
  ]);

  return {
    campaigns,
    templates,
    phoneNumbers: phoneNumbers.map((phone) => ({
      id: phone.id,
      label: [phone.verifiedName, phone.display].filter(Boolean).join(" · ") || phone.id,
    })),
  };
}

export async function getReportSummary(organizationId: string, filters: ReportFilters, timezone: string): Promise<ReportSummary> {
  const selectedWhere = campaignWhere(organizationId, filters, timezone);
  const result = await db.execute(sql`
    WITH selected_campaigns AS (
      SELECT c.id
      FROM campaigns c
      WHERE ${selectedWhere}
    )
    SELECT
      (SELECT count(*) FROM selected_campaigns)::bigint AS campaigns,
      count(cr.id)::bigint AS recipients,
      count(cr.id) FILTER (WHERE cr.submitted_at IS NOT NULL)::bigint AS submitted,
      count(cr.id) FILTER (WHERE cr.status IN ('submitted', 'sent', 'delivered', 'read'))::bigint AS accepted,
      count(cr.id) FILTER (WHERE cr.status IN ('sent', 'delivered', 'read'))::bigint AS sent,
      count(cr.id) FILTER (WHERE cr.status IN ('delivered', 'read'))::bigint AS delivered,
      count(cr.id) FILTER (WHERE cr.status = 'read')::bigint AS read,
      count(cr.id) FILTER (WHERE cr.status = 'failed')::bigint AS failed,
      count(cr.id) FILTER (WHERE cr.status = 'skipped')::bigint AS skipped,
      (
        SELECT count(DISTINCT ce.id)
        FROM contact_consent_events ce
        WHERE ce.organization_id = ${organizationId}::uuid
          AND ce.event_type = 'opt_out'
          AND (ce.occurred_at AT TIME ZONE ${timezone})::date BETWEEN ${filters.fromDate}::date AND ${filters.toDate}::date
          AND EXISTS (
            SELECT 1
            FROM campaign_recipients cr2
            INNER JOIN selected_campaigns sc2 ON sc2.id = cr2.campaign_id
            WHERE cr2.organization_id = ${organizationId}::uuid
              AND cr2.contact_id = ce.contact_id
          )
      )::bigint AS opt_outs
    FROM selected_campaigns sc
    LEFT JOIN campaign_recipients cr
      ON cr.campaign_id = sc.id
      AND cr.organization_id = ${organizationId}::uuid
  `);

  const row = resultRows<Record<string, unknown>>(result)[0] ?? {};
  const campaigns = numberValue(row.campaigns);
  const recipients = numberValue(row.recipients);
  const submitted = numberValue(row.submitted);
  const accepted = numberValue(row.accepted);
  const sent = numberValue(row.sent);
  const delivered = numberValue(row.delivered);
  const read = numberValue(row.read);
  const failed = numberValue(row.failed);
  const skipped = numberValue(row.skipped);
  const optOuts = numberValue(row.opt_outs);

  return {
    campaigns,
    recipients,
    submitted,
    accepted,
    sent,
    delivered,
    read,
    failed,
    skipped,
    optOuts,
    rates: {
      acceptance: ratio(accepted, recipients),
      delivery: ratio(delivered, accepted),
      read: ratio(read, delivered),
      failure: ratio(failed, recipients),
      optOut: ratio(optOuts, delivered),
    },
  };
}

export async function getReportSeries(organizationId: string, filters: ReportFilters, timezone: string): Promise<ReportSeriesPoint[]> {
  const selectedWhere = campaignWhere(organizationId, filters, timezone);
  const result = await db.execute(sql`
    WITH selected_campaigns AS (
      SELECT c.id
      FROM campaigns c
      WHERE ${selectedWhere}
    ), recipient_events AS (
      SELECT
        (v.event_at AT TIME ZONE ${timezone})::date AS day,
        v.metric
      FROM campaign_recipients cr
      INNER JOIN selected_campaigns sc ON sc.id = cr.campaign_id
      CROSS JOIN LATERAL (
        VALUES
          ('submitted'::text, cr.submitted_at),
          ('delivered'::text, cr.delivered_at),
          ('read'::text, cr.read_at),
          ('failed'::text, cr.failed_at)
      ) AS v(metric, event_at)
      WHERE cr.organization_id = ${organizationId}::uuid
        AND v.event_at IS NOT NULL
        AND (v.event_at AT TIME ZONE ${timezone})::date BETWEEN ${filters.fromDate}::date AND ${filters.toDate}::date
    ), opt_out_events AS (
      SELECT (ce.occurred_at AT TIME ZONE ${timezone})::date AS day, 'opt_outs'::text AS metric
      FROM contact_consent_events ce
      WHERE ce.organization_id = ${organizationId}::uuid
        AND ce.event_type = 'opt_out'
        AND (ce.occurred_at AT TIME ZONE ${timezone})::date BETWEEN ${filters.fromDate}::date AND ${filters.toDate}::date
        AND EXISTS (
          SELECT 1
          FROM campaign_recipients cr2
          INNER JOIN selected_campaigns sc2 ON sc2.id = cr2.campaign_id
          WHERE cr2.organization_id = ${organizationId}::uuid
            AND cr2.contact_id = ce.contact_id
        )
    ), events AS (
      SELECT day, metric FROM recipient_events
      UNION ALL
      SELECT day, metric FROM opt_out_events
    ), days AS (
      SELECT generate_series(${filters.fromDate}::date, ${filters.toDate}::date, '1 day'::interval)::date AS day
    )
    SELECT
      d.day::text AS day,
      count(e.metric) FILTER (WHERE e.metric = 'submitted')::bigint AS submitted,
      count(e.metric) FILTER (WHERE e.metric = 'delivered')::bigint AS delivered,
      count(e.metric) FILTER (WHERE e.metric = 'read')::bigint AS read,
      count(e.metric) FILTER (WHERE e.metric = 'failed')::bigint AS failed,
      count(e.metric) FILTER (WHERE e.metric = 'opt_outs')::bigint AS opt_outs
    FROM days d
    LEFT JOIN events e ON e.day = d.day
    GROUP BY d.day
    ORDER BY d.day ASC
  `);

  return resultRows<Record<string, unknown>>(result).map((row) => ({
    day: String(row.day),
    submitted: numberValue(row.submitted),
    delivered: numberValue(row.delivered),
    read: numberValue(row.read),
    failed: numberValue(row.failed),
    optOuts: numberValue(row.opt_outs),
  }));
}

async function campaignRows(organizationId: string, filters: ReportFilters, timezone: string, limit: number, offset: number): Promise<{ rows: CampaignReportRow[]; total: number }> {
  const selectedWhere = campaignWhere(organizationId, filters, timezone);
  const result = await db.execute(sql`
    WITH selected_campaigns AS (
      SELECT c.*
      FROM campaigns c
      WHERE ${selectedWhere}
    )
    SELECT
      c.id,
      c.name,
      c.created_at,
      count(cr.id)::bigint AS audience_size,
      count(cr.id) FILTER (WHERE cr.status IN ('submitted', 'sent', 'delivered', 'read'))::bigint AS accepted,
      count(cr.id) FILTER (WHERE cr.status IN ('delivered', 'read'))::bigint AS delivered,
      count(cr.id) FILTER (WHERE cr.status = 'read')::bigint AS read,
      count(cr.id) FILTER (WHERE cr.status = 'failed')::bigint AS failed,
      (
        SELECT count(DISTINCT ce.id)
        FROM contact_consent_events ce
        WHERE ce.organization_id = ${organizationId}::uuid
          AND ce.event_type = 'opt_out'
          AND (ce.occurred_at AT TIME ZONE ${timezone})::date BETWEEN ${filters.fromDate}::date AND ${filters.toDate}::date
          AND EXISTS (
            SELECT 1 FROM campaign_recipients cr2
            WHERE cr2.organization_id = ${organizationId}::uuid
              AND cr2.campaign_id = c.id
              AND cr2.contact_id = ce.contact_id
          )
      )::bigint AS opt_outs,
      count(*) OVER()::bigint AS total_rows
    FROM selected_campaigns c
    LEFT JOIN campaign_recipients cr
      ON cr.campaign_id = c.id
      AND cr.organization_id = ${organizationId}::uuid
    GROUP BY c.id, c.name, c.created_at
    ORDER BY c.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `);

  const raw = resultRows<Record<string, unknown>>(result);
  const rows = raw.map((row) => {
    const audienceSize = numberValue(row.audience_size);
    const accepted = numberValue(row.accepted);
    const delivered = numberValue(row.delivered);
    const read = numberValue(row.read);
    const failed = numberValue(row.failed);
    return {
      id: String(row.id),
      name: String(row.name),
      audienceSize,
      accepted,
      delivered,
      read,
      failed,
      optOuts: numberValue(row.opt_outs),
      deliveryRate: ratio(delivered, accepted),
      readRate: ratio(read, delivered),
      failureRate: ratio(failed, audienceSize),
    };
  });
  return { rows, total: numberValue(raw[0]?.total_rows) };
}

async function templateRows(organizationId: string, filters: ReportFilters, timezone: string, limit: number, offset: number): Promise<{ rows: TemplateReportRow[]; total: number }> {
  const selectedWhere = campaignWhere(organizationId, filters, timezone);
  const result = await db.execute(sql`
    WITH selected_campaigns AS (
      SELECT c.* FROM campaigns c WHERE ${selectedWhere}
    )
    SELECT
      t.id,
      t.name,
      t.language,
      count(DISTINCT c.id)::bigint AS campaigns,
      count(cr.id)::bigint AS recipients,
      count(cr.id) FILTER (WHERE cr.status IN ('delivered', 'read'))::bigint AS delivered,
      count(cr.id) FILTER (WHERE cr.status = 'read')::bigint AS read,
      count(cr.id) FILTER (WHERE cr.status = 'failed')::bigint AS failed,
      count(*) OVER()::bigint AS total_rows
    FROM selected_campaigns c
    INNER JOIN templates t
      ON t.id = c.template_id
      AND t.organization_id = ${organizationId}::uuid
    LEFT JOIN campaign_recipients cr
      ON cr.campaign_id = c.id
      AND cr.organization_id = ${organizationId}::uuid
    GROUP BY t.id, t.name, t.language
    ORDER BY count(DISTINCT c.id) DESC, t.name ASC
    LIMIT ${limit} OFFSET ${offset}
  `);

  const raw = resultRows<Record<string, unknown>>(result);
  const rows = raw.map((row) => {
    const recipients = numberValue(row.recipients);
    const delivered = numberValue(row.delivered);
    const read = numberValue(row.read);
    const failed = numberValue(row.failed);
    return {
      id: String(row.id),
      name: String(row.name),
      language: String(row.language),
      campaigns: numberValue(row.campaigns),
      recipients,
      delivered,
      read,
      failed,
      deliveryRate: ratio(delivered, recipients - failed),
      readRate: ratio(read, delivered),
      failureRate: ratio(failed, recipients),
    };
  });
  return { rows, total: numberValue(raw[0]?.total_rows) };
}

async function audienceRows(organizationId: string, filters: ReportFilters, timezone: string, limit: number, offset: number): Promise<{ rows: AudienceReportRow[]; total: number }> {
  const selectedWhere = campaignWhere(organizationId, filters, timezone);
  const result = await db.execute(sql`
    WITH selected_campaigns AS (
      SELECT c.* FROM campaigns c WHERE ${selectedWhere}
    )
    SELECT
      coalesce(ca.source_id::text, ca.type || ':' || ca.source_name) AS key,
      ca.source_name AS name,
      ca.type,
      count(DISTINCT c.id)::bigint AS campaigns,
      count(cr.id)::bigint AS recipients,
      count(cr.id) FILTER (WHERE cr.status IN ('delivered', 'read'))::bigint AS delivered,
      count(cr.id) FILTER (WHERE cr.status = 'read')::bigint AS read,
      count(cr.id) FILTER (WHERE cr.status = 'failed')::bigint AS failed,
      count(*) OVER()::bigint AS total_rows
    FROM selected_campaigns c
    INNER JOIN campaign_audiences ca
      ON ca.campaign_id = c.id
      AND ca.organization_id = ${organizationId}::uuid
    LEFT JOIN campaign_recipients cr
      ON cr.campaign_id = c.id
      AND cr.organization_id = ${organizationId}::uuid
    GROUP BY ca.source_id, ca.source_name, ca.type
    ORDER BY count(DISTINCT c.id) DESC, ca.source_name ASC
    LIMIT ${limit} OFFSET ${offset}
  `);

  const raw = resultRows<Record<string, unknown>>(result);
  const rows = raw.map((row) => {
    const recipients = numberValue(row.recipients);
    const delivered = numberValue(row.delivered);
    const read = numberValue(row.read);
    const failed = numberValue(row.failed);
    return {
      key: String(row.key),
      name: String(row.name),
      type: String(row.type),
      campaigns: numberValue(row.campaigns),
      recipients,
      delivered,
      read,
      failed,
      deliveryRate: ratio(delivered, recipients - failed),
      readRate: ratio(read, delivered),
      failureRate: ratio(failed, recipients),
    };
  });
  return { rows, total: numberValue(raw[0]?.total_rows) };
}

async function phoneRows(organizationId: string, filters: ReportFilters, timezone: string, limit: number, offset: number): Promise<{ rows: PhoneReportRow[]; total: number }> {
  const selectedWhere = campaignWhere(organizationId, filters, timezone);
  const result = await db.execute(sql`
    WITH selected_campaigns AS (
      SELECT c.* FROM campaigns c WHERE ${selectedWhere}
    )
    SELECT
      p.id,
      coalesce(p.display_phone_number, p.phone_number_id) AS number,
      coalesce(p.quality_rating, 'unknown') AS quality,
      p.throughput_mps AS throughput,
      count(DISTINCT c.id)::bigint AS campaigns,
      count(cr.id) FILTER (WHERE cr.submitted_at IS NOT NULL)::bigint AS submitted,
      count(cr.id) FILTER (WHERE cr.status IN ('delivered', 'read'))::bigint AS delivered,
      count(cr.id) FILTER (WHERE cr.status = 'failed')::bigint AS failed,
      count(*) OVER()::bigint AS total_rows
    FROM selected_campaigns c
    INNER JOIN whatsapp_phone_numbers p
      ON p.id = c.whatsapp_phone_number_id
      AND p.organization_id = ${organizationId}::uuid
    LEFT JOIN campaign_recipients cr
      ON cr.campaign_id = c.id
      AND cr.organization_id = ${organizationId}::uuid
    GROUP BY p.id, p.display_phone_number, p.phone_number_id, p.quality_rating, p.throughput_mps
    ORDER BY count(DISTINCT c.id) DESC, number ASC
    LIMIT ${limit} OFFSET ${offset}
  `);

  const raw = resultRows<Record<string, unknown>>(result);
  const rows = raw.map((row) => {
    const submitted = numberValue(row.submitted);
    const delivered = numberValue(row.delivered);
    const failed = numberValue(row.failed);
    return {
      id: String(row.id),
      number: String(row.number),
      campaigns: numberValue(row.campaigns),
      submitted,
      delivered,
      failed,
      quality: String(row.quality),
      throughput: numberValue(row.throughput),
      deliveryRate: ratio(delivered, submitted),
      failureRate: ratio(failed, submitted),
    };
  });
  return { rows, total: numberValue(raw[0]?.total_rows) };
}

export async function getReportRows(
  kind: ReportKind,
  organizationId: string,
  filters: ReportFilters,
  timezone: string,
  pageSize = 50,
): Promise<PagedReportRows> {
  const safePageSize = Math.max(1, Math.min(pageSize, 50_000));
  const offset = pageSize >= 50_000 ? 0 : (filters.page - 1) * safePageSize;
  if (kind === "campaigns") return campaignRows(organizationId, filters, timezone, safePageSize, offset);
  if (kind === "templates") return templateRows(organizationId, filters, timezone, safePageSize, offset);
  if (kind === "audiences") return audienceRows(organizationId, filters, timezone, safePageSize, offset);
  return phoneRows(organizationId, filters, timezone, safePageSize, offset);
}
