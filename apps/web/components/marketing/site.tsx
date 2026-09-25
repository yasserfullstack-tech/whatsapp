import Link from "next/link";
import type { ReactNode } from "react";
import { getMarketingCopy, type MarketingSlug } from "@/lib/marketing-content";
import type { Locale } from "@/lib/i18n";

export function MarketingShell({ locale, children }: { locale: Locale; children: ReactNode }) {
  const copy = getMarketingCopy(locale);
  return <div className="mkt-site">
    <header className="mkt-header"><div className="mkt-container mkt-nav-row">
      <Link className="mkt-brand" href="/"><span className="mkt-logo">W</span>{copy.brand}</Link>
      <nav className="mkt-nav"><Link href="/features">Features</Link><Link href="/pricing">Pricing</Link><Link href="/security">Security</Link></nav>
      <div className="mkt-actions"><Link href="/sign-in">{copy.signIn}</Link><Link className="mkt-button" href="/sign-up">{copy.start}</Link></div>
    </div></header>
    <main>{children}</main>
    <footer className="mkt-footer"><div className="mkt-container">{copy.footer.note}</div></footer>
  </div>;
}

export function MarketingHome({ locale }: { locale: Locale }) {
  const home = getMarketingCopy(locale).home;
  return <>
    <section className="mkt-hero"><div className="mkt-container mkt-hero-grid">
      <div className="mkt-copy"><span className="mkt-eyebrow">Business messaging platform</span><h1>{home.title}</h1><p className="mkt-lead">{home.description}</p>
      <div className="mkt-hero-actions"><Link className="mkt-button" href="/sign-up">{home.primaryCta}</Link><a className="mkt-secondary-button" href="#platform">Explore platform</a></div></div>
      <div className="mkt-product-window"><div className="mkt-window-header"><span>Campaign AI</span><span className="live">● Live</span></div><div className="mkt-chat"><p>New customer message</p><strong>How can we help?</strong></div><div className="mkt-stats">{home.metrics.map((m)=><div key={m.label}><small>{m.label}</small><b>{m.value}</b></div>)}</div></div>
    </div></section>

    <section id="platform" className="mkt-section"><div className="mkt-container"><span className="mkt-eyebrow">Everything in one place</span><h2>{home.featureTitle}</h2><p>{home.featureIntro}</p><div className="mkt-card-grid">{home.features.map(f=><article className="mkt-card" key={f.title}><h3>{f.title}</h3><p>{f.body}</p></article>)}</div></div></section>

    <section className="mkt-section mkt-dark-panel"><div className="mkt-container"><span className="mkt-eyebrow">Workflow</span><h2>{home.howTitle}</h2><div className="mkt-step-grid">{home.how.map(s=><article key={s.title}><h3>{s.title}</h3><p>{s.body}</p></article>)}</div></div></section>

    <section className="mkt-section"><div className="mkt-container mkt-trust"><div><span className="mkt-eyebrow">Built for growth</span><h2>{home.metaTitle}</h2><p>{home.metaBody}</p></div><div><span className="mkt-eyebrow">Reliable operations</span><h2>{home.trustTitle}</h2><p>{home.trustBody}</p></div></div></section>

    <section className="mkt-container mkt-final"><h2>{home.ctaTitle}</h2><p>{home.ctaBody}</p><Link className="mkt-button" href="/sign-up">{home.primaryCta}</Link></section>
  </>;
}

export function MarketingContentPage({ locale, slug }: { locale: Locale; slug: MarketingSlug }) {
 const page=getMarketingCopy(locale).pages[slug];
 return <section className="mkt-page-hero"><div className="mkt-container"><h1>{page.title}</h1><p className="mkt-lead">{page.description}</p></div></section>;
}
