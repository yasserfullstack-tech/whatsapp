import Link from "next/link";
import { AppSidebar } from "@/components/app-sidebar";
import { requireAuthContext } from "@/lib/auth-context";
import { getI18n } from "@/lib/i18n/server";
import { filtersToSearchParams, parseReportFilters, percent, ratio, type ReportFilters, type ReportKind } from "@/lib/reporting-core";
import { getReportingCopy } from "@/lib/reporting-copy";
import {
  getReportFilterOptions,
  getReportRows,
  getReportSeries,
  getReportSummary,
  getReportingTimezone,
  type AudienceReportRow,
  type CampaignReportRow,
  type PhoneReportRow,
  type ReportRows,
  type TemplateReportRow,
} from "@/lib/reporting";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type ReportViewKind = "overview" | ReportKind;

const paths: Record<ReportViewKind, string> = {
  overview: "/reports",
  campaigns: "/reports/campaigns",
  templates: "/reports/templates",
  audiences: "/reports/audiences",
  "phone-numbers": "/reports/phone-numbers",
};

function titleFor(kind: ReportViewKind, copy: ReturnType<typeof getReportingCopy>) {
  if (kind === "campaigns") return { title: copy.campaigns, subtitle: copy.campaignsSubtitle };
  if (kind === "templates") return { title: copy.templates, subtitle: copy.templatesSubtitle };
  if (kind === "audiences") return { title: copy.audiences, subtitle: copy.audiencesSubtitle };
  if (kind === "phone-numbers") return { title: copy.phoneNumbers, subtitle: copy.phoneNumbersSubtitle };
  return { title: copy.reports, subtitle: copy.reportsSubtitle };
}

function buildHref(path: string, filters: ReportFilters, page?: number) {
  const params = filtersToSearchParams(filters, true);
  if (page && page > 1) params.set("page", String(page));
  else params.delete("page");
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function MiniChart({ values, labels, valueLabel, percentValues = false }: { values: number[]; labels: string[]; valueLabel: string; percentValues?: boolean }) {
  const max = Math.max(1, ...values);
  const width = 600;
  const height = 180;
  const padding = 14;
  const usableWidth = width - padding * 2;
  const usableHeight = height - padding * 2;
  const points = values.map((value, index) => {
    const x = values.length <= 1 ? padding + usableWidth / 2 : padding + (index / (values.length - 1)) * usableWidth;
    const y = padding + usableHeight - (Math.max(0, value) / max) * usableHeight;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const last = values.at(-1) ?? 0;
  const formattedLast = percentValues ? percent(last) : new Intl.NumberFormat().format(last);
  const firstLabel = labels[0] ?? "";
  const lastLabel = labels.at(-1) ?? "";

  return <article className="reportChart">
    <div className="reportChartHeader"><strong>{valueLabel}</strong><span>{formattedLast}</span></div>
    {values.length ? <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={valueLabel} preserveAspectRatio="none">
      <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} className="reportChartAxis" />
      <polyline points={points} fill="none" className="reportChartLine" vectorEffect="non-scaling-stroke" />
    </svg> : <div className="reportChartEmpty" />}
    <div className="reportChartLabels"><span>{firstLabel}</span><span>{lastLabel}</span></div>
  </article>;
}

function EmptyReport({ copy }: { copy: ReturnType<typeof getReportingCopy> }) {
  return <div className="reportEmpty"><strong>{copy.noData}</strong><p>{copy.noDataHelp}</p></div>;
}

function CampaignTable({ rows, copy, number }: { rows: CampaignReportRow[]; copy: ReturnType<typeof getReportingCopy>; number: Intl.NumberFormat }) {
  if (!rows.length) return <EmptyReport copy={copy} />;
  return <div className="reportTableWrap"><table className="reportTable"><thead><tr>
    <th>{copy.campaign}</th><th>{copy.audienceSize}</th><th>{copy.accepted}</th><th>{copy.delivered}</th><th>{copy.read}</th><th>{copy.failed}</th><th>{copy.optOuts}</th><th>{copy.deliveryPercent}</th><th>{copy.readPercent}</th><th>{copy.failurePercent}</th>
  </tr></thead><tbody>{rows.map((row) => <tr key={row.id}>
    <td><Link href={`/campaigns/${row.id}`}>{row.name}</Link></td><td>{number.format(row.audienceSize)}</td><td>{number.format(row.accepted)}</td><td>{number.format(row.delivered)}</td><td>{number.format(row.read)}</td><td>{number.format(row.failed)}</td><td>{number.format(row.optOuts)}</td><td>{percent(row.deliveryRate)}</td><td>{percent(row.readRate)}</td><td>{percent(row.failureRate)}</td>
  </tr>)}</tbody></table></div>;
}

function TemplateTable({ rows, copy, number }: { rows: TemplateReportRow[]; copy: ReturnType<typeof getReportingCopy>; number: Intl.NumberFormat }) {
  if (!rows.length) return <EmptyReport copy={copy} />;
  return <div className="reportTableWrap"><table className="reportTable"><thead><tr>
    <th>{copy.template}</th><th>{copy.language}</th><th>{copy.totalCampaigns}</th><th>{copy.recipients}</th><th>{copy.delivered}</th><th>{copy.read}</th><th>{copy.failed}</th><th>{copy.deliveryRate}</th><th>{copy.readRate}</th><th>{copy.failureRate}</th>
  </tr></thead><tbody>{rows.map((row) => <tr key={row.id}>
    <td>{row.name}</td><td>{row.language}</td><td>{number.format(row.campaigns)}</td><td>{number.format(row.recipients)}</td><td>{number.format(row.delivered)}</td><td>{number.format(row.read)}</td><td>{number.format(row.failed)}</td><td>{percent(row.deliveryRate)}</td><td>{percent(row.readRate)}</td><td>{percent(row.failureRate)}</td>
  </tr>)}</tbody></table></div>;
}

function AudienceTable({ rows, copy, number }: { rows: AudienceReportRow[]; copy: ReturnType<typeof getReportingCopy>; number: Intl.NumberFormat }) {
  if (!rows.length) return <EmptyReport copy={copy} />;
  return <div className="reportTableWrap"><table className="reportTable"><thead><tr>
    <th>{copy.listSegment}</th><th>{copy.type}</th><th>{copy.totalCampaigns}</th><th>{copy.recipients}</th><th>{copy.delivered}</th><th>{copy.read}</th><th>{copy.failed}</th><th>{copy.deliveryRate}</th><th>{copy.readRate}</th><th>{copy.failureRate}</th>
  </tr></thead><tbody>{rows.map((row) => <tr key={row.key}>
    <td>{row.name}</td><td>{row.type}</td><td>{number.format(row.campaigns)}</td><td>{number.format(row.recipients)}</td><td>{number.format(row.delivered)}</td><td>{number.format(row.read)}</td><td>{number.format(row.failed)}</td><td>{percent(row.deliveryRate)}</td><td>{percent(row.readRate)}</td><td>{percent(row.failureRate)}</td>
  </tr>)}</tbody></table></div>;
}

function PhoneTable({ rows, copy, number }: { rows: PhoneReportRow[]; copy: ReturnType<typeof getReportingCopy>; number: Intl.NumberFormat }) {
  if (!rows.length) return <EmptyReport copy={copy} />;
  return <div className="reportTableWrap"><table className="reportTable"><thead><tr>
    <th>{copy.number}</th><th>{copy.totalCampaigns}</th><th>{copy.submitted}</th><th>{copy.delivered}</th><th>{copy.failed}</th><th>{copy.quality}</th><th>{copy.throughput}</th><th>{copy.deliveryRate}</th><th>{copy.failureRate}</th>
  </tr></thead><tbody>{rows.map((row) => <tr key={row.id}>
    <td dir="ltr">{row.number}</td><td>{number.format(row.campaigns)}</td><td>{number.format(row.submitted)}</td><td>{number.format(row.delivered)}</td><td>{number.format(row.failed)}</td><td>{row.quality}</td><td>{number.format(row.throughput)} {copy.throughputUnit}</td><td>{percent(row.deliveryRate)}</td><td>{percent(row.failureRate)}</td>
  </tr>)}</tbody></table></div>;
}

function ReportTable({ kind, rows, copy, number }: { kind: ReportKind; rows: ReportRows; copy: ReturnType<typeof getReportingCopy>; number: Intl.NumberFormat }) {
  if (kind === "campaigns") return <CampaignTable rows={rows as CampaignReportRow[]} copy={copy} number={number} />;
  if (kind === "templates") return <TemplateTable rows={rows as TemplateReportRow[]} copy={copy} number={number} />;
  if (kind === "audiences") return <AudienceTable rows={rows as AudienceReportRow[]} copy={copy} number={number} />;
  return <PhoneTable rows={rows as PhoneReportRow[]} copy={copy} number={number} />;
}

export async function ReportingView({ kind, searchParams }: { kind: ReportViewKind; searchParams: SearchParams }) {
  const [{ session, workspace }, { locale, localeTag }] = await Promise.all([requireAuthContext(), getI18n()]);
  const copy = getReportingCopy(locale);
  const organizationId = workspace.organizationId;
  const timezone = await getReportingTimezone(organizationId);
  const filters = parseReportFilters(await searchParams, timezone);
  const tableKind: ReportKind = kind === "overview" ? "campaigns" : kind;
  const pageSize = kind === "overview" ? 10 : 50;
  const [options, summary, series, table] = await Promise.all([
    getReportFilterOptions(organizationId),
    getReportSummary(organizationId, filters, timezone),
    kind === "overview" ? getReportSeries(organizationId, filters, timezone) : Promise.resolve([]),
    getReportRows(tableKind, organizationId, filters, timezone, pageSize),
  ]);
  const number = new Intl.NumberFormat(localeTag);
  const date = new Intl.DateTimeFormat(localeTag, { month: "short", day: "numeric" });
  const heading = titleFor(kind, copy);
  const initials = workspace.organizationName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const currentPath = paths[kind];
  const exportParams = filtersToSearchParams(filters, false);
  exportParams.set("report", tableKind);
  const exportHref = `/api/reports/export?${exportParams.toString()}`;
  const totalPages = Math.max(1, Math.ceil(table.total / pageSize));
  const chartLabels = series.map((point) => date.format(new Date(`${point.day}T12:00:00Z`)));
  const tabs: Array<{ kind: ReportViewKind; label: string }> = [
    { kind: "overview", label: copy.overview },
    { kind: "campaigns", label: copy.campaigns },
    { kind: "templates", label: copy.templates },
    { kind: "audiences", label: copy.audiences },
    { kind: "phone-numbers", label: copy.phoneNumbers },
  ];

  return <main className="shell">
    <AppSidebar active="reports" workspaceName={workspace.organizationName} email={session.user.email} initials={initials} />
    <section className="content reportsContent">
      <header className="topbar reportsTopbar"><div><p className="eyebrow">{copy.reports}</p><h1>{heading.title}</h1><p className="subtitle">{heading.subtitle}</p></div><a className="secondary" href={exportHref}>{copy.exportCsv}</a></header>

      <nav className="reportTabs" aria-label={copy.reports}>{tabs.map((tab) => <Link key={tab.kind} className={tab.kind === kind ? "reportTab active" : "reportTab"} href={buildHref(paths[tab.kind], filters)}>{tab.label}</Link>)}</nav>

      <section className="panel reportFiltersPanel">
        <div className="panelHeader"><div><p className="eyebrow">{copy.filters}</p><h2>{copy.dateRange}</h2><p className="subtitle">{copy.timezone}: {timezone}</p></div></div>
        <form className="reportFilters" method="get" action={currentPath}>
          <label><span>{copy.dateRange}</span><select name="range" defaultValue={filters.range}><option value="today">{copy.today}</option><option value="7d">{copy.last7}</option><option value="30d">{copy.last30}</option><option value="custom">{copy.custom}</option></select></label>
          <label><span>{copy.from}</span><input type="date" name="from" defaultValue={filters.fromDate} /></label>
          <label><span>{copy.to}</span><input type="date" name="to" defaultValue={filters.toDate} /></label>
          <label><span>{copy.phoneNumber}</span><select name="phone" defaultValue={filters.phoneNumberId ?? ""}><option value="">{copy.allPhoneNumbers}</option>{options.phoneNumbers.map((phone) => <option key={phone.id} value={phone.id}>{phone.label}</option>)}</select></label>
          <label><span>{copy.campaign}</span><select name="campaign" defaultValue={filters.campaignId ?? ""}><option value="">{copy.allCampaigns}</option>{options.campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label>
          <label><span>{copy.template}</span><select name="template" defaultValue={filters.templateId ?? ""}><option value="">{copy.allTemplates}</option>{options.templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
          <div className="reportFilterActions"><button type="submit" className="primary">{copy.apply}</button><Link className="secondary" href={currentPath}>{copy.reset}</Link></div>
        </form>
      </section>

      <section className="reportStats" aria-label={copy.reports}>
        {[
          [copy.totalCampaigns, summary.campaigns], [copy.recipients, summary.recipients], [copy.submitted, summary.submitted], [copy.sent, summary.sent], [copy.delivered, summary.delivered], [copy.read, summary.read], [copy.failed, summary.failed], [copy.skipped, summary.skipped], [copy.optOuts, summary.optOuts],
        ].map(([label, value]) => <article className="statCard" key={String(label)}><span>{label}</span><strong>{number.format(Number(value))}</strong></article>)}
      </section>

      <section className="reportRates" aria-label={copy.acceptanceRate}>
        {[
          [copy.acceptanceRate, summary.rates.acceptance], [copy.deliveryRate, summary.rates.delivery], [copy.readRate, summary.rates.read], [copy.failureRate, summary.rates.failure], [copy.optOutRate, summary.rates.optOut],
        ].map(([label, value]) => <article className="reportRate" key={String(label)}><span>{label}</span><strong>{percent(Number(value))}</strong></article>)}
      </section>

      {kind === "overview" ? <>
        <section className="reportCharts">
          <MiniChart values={series.map((point) => point.submitted)} labels={chartLabels} valueLabel={copy.messagesOverTime} />
          <MiniChart values={series.map((point) => point.delivered)} labels={chartLabels} valueLabel={copy.deliveryOverTime} />
          <MiniChart values={series.map((point) => ratio(point.read, point.delivered))} labels={chartLabels} valueLabel={copy.readRateOverTime} percentValues />
          <MiniChart values={series.map((point) => point.failed)} labels={chartLabels} valueLabel={copy.failuresOverTime} />
          <MiniChart values={series.map((point) => point.optOuts)} labels={chartLabels} valueLabel={copy.optOutsOverTime} />
        </section>
        <section className="panel reportTablePanel"><div className="panelHeader"><div><p className="eyebrow">{copy.campaignComparison}</p><h2>{copy.campaignComparison}</h2><p className="subtitle">{copy.campaignComparisonSubtitle}</p></div><Link href={buildHref(paths.campaigns, filters)}>{copy.campaigns} →</Link></div><CampaignTable rows={table.rows as CampaignReportRow[]} copy={copy} number={number} /></section>
      </> : <section className="panel reportTablePanel"><div className="panelHeader"><div><p className="eyebrow">{heading.title}</p><h2>{heading.title}</h2><p className="subtitle">{copy.sourceTruth}</p></div><a href={exportHref}>{copy.exportCsv}</a></div><ReportTable kind={kind} rows={table.rows} copy={copy} number={number} />
        {table.total > pageSize ? <div className="reportPagination"><Link aria-disabled={filters.page <= 1} className={filters.page <= 1 ? "disabled" : ""} href={buildHref(currentPath, filters, Math.max(1, filters.page - 1))}>{copy.previous}</Link><span>{copy.page} {number.format(filters.page)} {copy.of} {number.format(totalPages)}</span><Link aria-disabled={filters.page >= totalPages} className={filters.page >= totalPages ? "disabled" : ""} href={buildHref(currentPath, filters, Math.min(totalPages, filters.page + 1))}>{copy.next}</Link></div> : null}
      </section>}
    </section>
  </main>;
}
