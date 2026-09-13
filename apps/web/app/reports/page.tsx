import { ReportingView } from "@/components/reporting-view";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default function ReportsPage({ searchParams }: Props) {
  return <ReportingView kind="overview" searchParams={searchParams} />;
}
