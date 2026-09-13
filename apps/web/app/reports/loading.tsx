export default function ReportsLoading() {
  return <main className="shell"><section className="content reportsContent" aria-busy="true"><header className="topbar"><div><p className="eyebrow">Reports</p><h1>Loading reports…</h1><p className="subtitle">جاري تحميل التقارير…</p></div></header><section className="reportLoadingGrid">{Array.from({ length: 8 }, (_, index) => <div className="reportSkeleton" key={index} />)}</section></section></main>;
}
