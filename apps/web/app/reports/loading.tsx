"use client";

import { useI18n } from "@/components/i18n-provider";
import { productionUiMessages } from "@/lib/i18n/production-ui";

export default function ReportsLoading() {
  const { locale } = useI18n();
  const copy = productionUiMessages[locale].reports;
  return <main className="shell"><section className="content reportsContent" aria-busy="true"><header className="topbar"><div><p className="eyebrow">{copy.eyebrow}</p><h1>{copy.loading}</h1></div></header><section className="reportLoadingGrid">{Array.from({ length: 8 }, (_, index) => <div className="reportSkeleton" key={index} />)}</section></section></main>;
}
