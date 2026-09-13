import { ReportingView } from "@/components/reporting-view";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default function CampaignReportsPage({ searchParams }: Props) {
  return <ReportingView kind="campaigns" searchParams={searchParams} />;
}
