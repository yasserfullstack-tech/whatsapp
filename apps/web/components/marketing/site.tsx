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
    <footer className="mkt-footer"><div className="mkt-container"><p>{copy.footer.note}</p></div></footer>
  </div>;
}

export function MarketingHome({ locale }: { locale: Locale }) {
  const home = getMarketingCopy(locale).home;
  return <>
    <section className="mkt-hero"><div className="mkt-container mkt-hero-grid">
      <div className="mkt-copy"><span className="mkt-eyebrow">Business messaging platform</span><h1>{home.title}</h1><p className="mkt-lead">{home.description}</p><div className="mkt-hero-actions"><Link className="mkt-button" href="/sign-up">{home.primaryCta}</Link><a className="mkt-secondary-button" href="#platform">Explore platform</a></div></div>
      <div className="mkt-product-window"><div className="mkt-window-header"><span>Conversation workspace</span><span className="live">● Live</span></div><div className="mkt-chat"><small>Customer message</small><strong>AI replies, campaigns and analytics working together.</strong></div><div className="mkt-stats">{home.metrics.map((m)=><div key={m.label}><small>{m.label}</small><b>{m.value}</b></div>)}</div></div>
    </div></section>

    <section className="mkt-proof"><div className="mkt-container"><span>WhatsApp Business ready</span><span>Automation</span><span>Team inbox</span><span>Analytics</span></div></section>

    <section id="platform" className="mkt-section"><div className="mkt-container"><span className="mkt-eyebrow">Platform</span><h2>{home.featureTitle}</h2><p>{home.featureIntro}</p><div className="mkt-card-grid">{home.features.map(f=><article className="mkt-card" key={f.title}><h3>{f.title}</h3><p>{f.body}</p></article>)}</div></div></section>

    <section className="mkt-section mkt-dark-panel"><div className="mkt-container"><span className="mkt-eyebrow">How it works</span><h2>{home.howTitle}</h2><div className="mkt-step-grid">{home.how.map(s=><article key={s.title}><h3>{s.title}</h3><p>{s.body}</p></article>)}</div></div></section>

    <section className="mkt-section"><div className="mkt-container mkt-conversation"><span className="mkt-eyebrow">Customer journey</span><h2>Every message becomes an opportunity</h2><div className="mkt-conversation-grid"><article><b>01</b><h3>Receive</h3><p>Capture customer conversations instantly.</p></article><article><b>02</b><h3>Automate</h3><p>Create smart workflows and responses.</p></article><article><b>03</b><h3>Grow</h3><p>Measure results and improve engagement.</p></article></div></div></section>

    <section className="mkt-section"><div className="mkt-container mkt-trust"><div><span className="mkt-eyebrow">Integrations</span><h2>{home.metaTitle}</h2><p>{home.metaBody}</p></div><div><span className="mkt-eyebrow">Security</span><h2>{home.trustTitle}</h2><p>{home.trustBody}</p></div></div></section>

    <section className="mkt-section mkt-pricing-preview"><div className="mkt-container"><h2>Start simple, scale when you grow</h2><p>Flexible plans for businesses building better customer communication.</p><Link className="mkt-button" href="/pricing">View pricing</Link></div></section>

    <section className="mkt-container mkt-final"><h2>{home.ctaTitle}</h2><p>{home.ctaBody}</p><Link className="mkt-button" href="/sign-up">{home.primaryCta}</Link></section>
  </>;
}

export function MarketingContentPage({ locale, slug }: { locale: Locale; slug: MarketingSlug }) {
 const page=getMarketingCopy(locale).pages[slug];
 return <section className="mkt-page-hero"><div className="mkt-container"><h1>{page.title}</h1><p className="mkt-lead">{page.description}</p></div></section>;
}
