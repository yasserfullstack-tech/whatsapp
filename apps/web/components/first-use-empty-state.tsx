import Link from "next/link";
import type { Locale } from "@/lib/i18n";
import { getOnboardingCopy } from "@/lib/onboarding-copy";

type EmptyKind = "contacts" | "audiences" | "templates" | "campaigns";

export function FirstUseEmptyState({ kind, locale }: { kind: EmptyKind; locale: Locale }) {
  const item = getOnboardingCopy(locale).empty[kind];
  return (
    <section className="panel" style={{ marginTop: 18 }} data-empty-state={kind}>
      <div className="emptyState">
        <div className="emptyIcon" aria-hidden="true">{kind[0]?.toUpperCase()}</div>
        <h2>{item.title}</h2>
        <p>{item.description}</p>
        <Link className="secondary" href={item.href}>{item.cta}</Link>
      </div>
    </section>
  );
}
