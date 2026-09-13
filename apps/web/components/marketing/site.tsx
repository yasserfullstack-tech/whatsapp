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
          <Link className="mkt-brand" href="/" aria-label={copy.brand}>
            <span className="mkt-logo" aria-hidden="true">W</span>
            <span>{copy.brand}</span>
          </Link>
          <nav className="mkt-nav" aria-label={locale === "ar" ? "التنقل الرئيسي" : "Primary navigation"}>
            <Link href="/features">{copy.nav.features}</Link>
            <Link href="/pricing">{copy.nav.pricing}</Link>
            <Link href="/whatsapp">{copy.nav.whatsapp}</Link>
            <Link href="/security">{copy.nav.security}</Link>
            <Link href="/contact">{copy.nav.contact}</Link>
          </nav>
          <div className="mkt-actions">
            <Link className="mkt-link-button" href="/sign-in">{copy.signIn}</Link>
            <Link className="mkt-button mkt-button-small" href="/sign-up">{copy.start}</Link>
          </div>
        </div>
      </header>

      <main>{children}</main>

      <footer className="mkt-footer">
        <div className="mkt-container mkt-footer-grid">
          <div>
            <Link className="mkt-brand" href="/">
              <span className="mkt-logo" aria-hidden="true">W</span>
              <span>{copy.brand}</span>
            </Link>
            <p className="mkt-footer-note">{copy.footer.note}</p>
          </div>
          <div>
            <strong>{copy.footer.product}</strong>
            <Link href="/features">{copy.nav.features}</Link>
            <Link href="/pricing">{copy.nav.pricing}</Link>
            <Link href="/whatsapp">{copy.nav.whatsapp}</Link>
          </div>
          <div>
            <strong>{copy.footer.company}</strong>
            <Link href="/security">{copy.nav.security}</Link>
            <Link href="/contact">{copy.nav.contact}</Link>
          </div>
          <div>
            <strong>{copy.footer.legal}</strong>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/acceptable-use">Acceptable use</Link>
            <Link href="/anti-spam">Anti-spam</Link>
          </div>
        </div>
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
              <a className="mkt-secondary-button" href="#how-it-works">{home.secondaryCta}</a>
            </div>
            <p className="mkt-scale-note">{home.scaleNote}</p>
          </div>

          <div className="mkt-product-shot" aria-label={home.dashboardLabel}>
            <div className="mkt-shot-topbar">
              <span>{home.dashboardLabel}</span>
              <span className="mkt-live-dot">●</span>
            </div>
            <div className="mkt-shot-grid">
              {home.metrics.map((metric) => (
                <article key={metric.label}>
                  <span>{metric.label}</span>
                  <strong>{metric.value}</strong>
                </article>
              ))}
            </div>
            <div className="mkt-shot-chart" aria-hidden="true">
              <div style={{ height: "48%" }} />
              <div style={{ height: "70%" }} />
              <div style={{ height: "58%" }} />
              <div style={{ height: "84%" }} />
              <div style={{ height: "76%" }} />
              <div style={{ height: "94%" }} />
            </div>
          </div>
        </div>
      </section>

      <section className="mkt-section">
        <div className="mkt-container">
          <div className="mkt-section-heading">
            <p className="mkt-eyebrow">{copy.nav.features}</p>
            <h2>{home.featureTitle}</h2>
            <p>{home.featureIntro}</p>
          </div>
          <div className="mkt-card-grid">
            {home.features.map((feature) => (
              <article className="mkt-card" key={feature.title}>
                <span className="mkt-card-icon" aria-hidden="true">↗</span>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mkt-section mkt-section-muted" id="how-it-works">
        <div className="mkt-container">
          <div className="mkt-section-heading"><h2>{home.howTitle}</h2></div>
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

      <section className="mkt-section">
        <div className="mkt-container mkt-split">
          <article className="mkt-feature-panel">
            <p className="mkt-eyebrow">Meta</p>
            <h2>{home.metaTitle}</h2>
            <p>{home.metaBody}</p>
            <Link className="mkt-text-link" href="/whatsapp">{copy.nav.whatsapp} →</Link>
          </article>
          <article className="mkt-feature-panel mkt-feature-panel-dark">
            <p className="mkt-eyebrow">Trust</p>
            <h2>{home.trustTitle}</h2>
            <p>{home.trustBody}</p>
            <Link className="mkt-text-link" href="/security">{copy.nav.security} →</Link>
          </article>
        </div>
      </section>

      <section className="mkt-section mkt-section-muted">
        <div className="mkt-container mkt-faq-layout">
          <div className="mkt-section-heading"><h2>{home.faqTitle}</h2></div>
          <div className="mkt-faq-list">
            {home.faqs.map((faq) => (
              <details key={faq.question}>
                <summary>{faq.question}</summary>
                <p>{faq.answer}</p>
              </details>
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
    <>
      <section className="mkt-page-hero">
        <div className="mkt-container mkt-narrow">
          <p className="mkt-eyebrow">{page.eyebrow}</p>
          <h1>{page.title}</h1>
          <p className="mkt-lead">{page.description}</p>
        </div>
      </section>
      <section className="mkt-section">
        <div className="mkt-container mkt-content-stack">
          {page.sections.map((section) => (
            <article className="mkt-content-section" key={section.title}>
              <h2>{section.title}</h2>
              <p>{section.body}</p>
              {section.items ? (
                <ul>
                  {section.items.map((item) => <li key={item}>{item}</li>)}
                </ul>
              ) : null}
            </article>
          ))}
        </div>
      </section>
      {slug !== "privacy" && slug !== "terms" && slug !== "acceptable-use" && slug !== "anti-spam" ? (
        <section className="mkt-cta-section">
          <div className="mkt-container mkt-cta-box">
            <div>
              <h2>{copy.home.ctaTitle}</h2>
              <p>{copy.home.ctaBody}</p>
            </div>
            <Link className="mkt-button" href="/sign-up">{copy.start}</Link>
          </div>
        </section>
      ) : null}
    </>
  );
}
