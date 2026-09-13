import type { ReactNode } from "react";

export function AdminMetric({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return <article className="admin-metric"><span>{label}</span><strong>{value}</strong>{hint ? <small>{hint}</small> : null}</article>;
}

export function AdminBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: "good" | "warn" | "bad" | "neutral" }) {
  return <span className={`admin-badge admin-badge-${tone}`}>{children}</span>;
}

export function AdminSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return <section className="admin-card"><div className="admin-card-head"><h2>{title}</h2>{action}</div>{children}</section>;
}

export function AdminEmpty({ children }: { children: ReactNode }) {
  return <p className="admin-empty">{children}</p>;
}
