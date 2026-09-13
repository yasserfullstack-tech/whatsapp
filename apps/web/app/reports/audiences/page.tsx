import { ReportingView } from "@/components/reporting-view";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default function AudienceReportsPage({ searchParams }: Props) {
  return <ReportingView kind="audiences" searchParams={searchParams} />;
}
