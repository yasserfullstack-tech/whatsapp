import Link from "next/link";
import type { ReactNode } from "react";
import { getMarketingCopy, type MarketingSlug } from "@/lib/marketing-content";
import type { Locale } from "@/lib/i18n";

export function MarketingShell({ locale, children }: { locale: Locale; children: ReactNode }) {
  const copy = getMarketingCopy(locale);

  return (
    <div className="mkt-site">
      <header className="mkt-header">
        <div className="mkt-container mkt-nav-row">
          <Link className="mkt-brand" href="/">
            <span className="mkt-logo">W</span>
            {copy.brand}
          </Link>
          <nav className="mkt-nav">
            <Link href="/features">{copy.nav.features}</Link>
            <Link href="/pricing">{copy.nav.pricing}</Link>
            <Link href="/security">{copy.nav.security}</Link>
          </nav>
          <div className="mkt-actions">
            <Link className="mkt-link-button" href="/sign-in">{copy.signIn}</Link>
            <Link className="mkt-button mkt-button-small" href="/sign-up">{copy.start}</Link>
          </div>
        </div>
      </header>
      <main>{children}</main>
      <footer className="mkt-footer">
        <div className="mkt-container">{copy.footer.note}</div>
      </footer>
    </div>
  );
}

export function MarketingHome({ locale }: { locale: Locale }) {
  const copy = getMarketingCopy(locale);
  const home = copy.home;

  return (
    <>
      <section className="mkt-hero">
        <div className="mkt-container mkt-hero-grid">
          <div className="mkt-hero-copy">
            <p className="mkt-eyebrow">{home.eyebrow}</p>
            <h1>{home.title}</h1>
            <p className="mkt-lead">{home.description}</p>
            <div className="mkt-hero-actions">
              <Link className="mkt-button" href="/sign-up">{home.primaryCta}</Link>
              <a className="mkt-secondary-button" href="#workflow">{home.secondaryCta}</a>
            </div>
          </div>
          <div className="mkt-product-shot" aria-label={home.dashboardLabel}>
            <div className="mkt-shot-topbar">{home.dashboardLabel}</div>
            <div className="mkt-shot-grid">
              {home.metrics.map((metric) => (
                <article key={metric.label}>
                  <span>{metric.label}</span>
                  <strong>{metric.value}</strong>
                </article>
              ))}
            </div>
            <div className="mkt-chat-preview">
              <div>Customer message</div>
              <strong>Campaign delivered ✓</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="mkt-section">
        <div className="mkt-container">
          <div className="mkt-section-heading">
            <h2>{home.featureTitle}</h2>
            <p>{home.featureIntro}</p>
          </div>
          <div className="mkt-card-grid">
            {home.features.map((feature) => (
              <article className="mkt-card" key={feature.title}>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mkt-section mkt-section-muted" id="workflow">
        <div className="mkt-container">
          <h2>{home.howTitle}</h2>
          <div className="mkt-step-grid">
            {home.how.map((step) => (
              <article key={step.title}>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mkt-cta-section">
        <div className="mkt-container mkt-cta-box">
          <div>
            <h2>{home.ctaTitle}</h2>
            <p>{home.ctaBody}</p>
          </div>
          <Link className="mkt-button" href="/sign-up">{home.primaryCta}</Link>
        </div>
      </section>
    </>
  );
}

export function MarketingContentPage({ locale, slug }: { locale: Locale; slug: MarketingSlug }) {
  const copy = getMarketingCopy(locale);
  const page = copy.pages[slug];

  return (
    <section className="mkt-page-hero">
      <div className="mkt-container mkt-narrow">
        <p className="mkt-eyebrow">{page.eyebrow}</p>
        <h1>{page.title}</h1>
        <p className="mkt-lead">{page.description}</p>
      </div>
    </section>
  );
}
