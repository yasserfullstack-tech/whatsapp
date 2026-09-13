"use client";

import { useI18n } from "@/components/i18n-provider";
import { getReportingCopy } from "@/lib/reporting-copy";

export default function ReportsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { locale } = useI18n();
  const copy = getReportingCopy(locale);
  return <main className="shell"><section className="content"><div className="panel reportError" role="alert"><p className="eyebrow">{copy.reports}</p><h1>{copy.errorTitle}</h1><p className="subtitle">{copy.errorHelp}</p><button className="primary" type="button" onClick={reset}>{copy.retry}</button></div></section></main>;
}
