import Link from "next/link";
import type { ReactNode } from "react";
import { getMarketingCopy, type MarketingSlug } from "@/lib/marketing-content";
import type { Locale } from "@/lib/i18n";

export function MarketingShell({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  const copy = getMarketingCopy(locale);
  return (
    <div className="mkt-site">
      <header className="mkt-header">
        <div className="mkt-container mkt-nav-row">
          <Link className="mkt-brand" href="/">
            {copy.brand}
          </Link>
          <nav
            className="mkt-nav"
            aria-label={locale === "ar" ? "التنقل الرئيسي" : "Main navigation"}
          >
            <Link href="/features">{copy.nav.features}</Link>
            <Link href="/pricing">{copy.nav.pricing}</Link>
            <Link href="/security">{copy.nav.security}</Link>
          </nav>
          <div className="mkt-actions">
            <Link href="/sign-in">{copy.signIn}</Link>
            <Link className="mkt-button" href="/sign-up">
              {copy.start}
            </Link>
          </div>
        </div>
      </header>
      <main>{children}</main>
      <footer className="mkt-footer">
        <div className="mkt-container">
          <Link className="mkt-brand" href="/">
            {copy.brand}
          </Link>
          <p>{copy.footer.note}</p>
        </div>
      </footer>
    </div>
  );
}

export function MarketingHome({ locale }: { locale: Locale }) {
  const home = getMarketingCopy(locale).home;
  return (
    <>
      <section className="mkt-hero">
        <div className="mkt-container mkt-hero-grid">
          <div className="mkt-hero-copy">
            <p className="mkt-section-label">{home.eyebrow}</p>
            <h1>{home.title}</h1>
            <p className="mkt-hero-description">{home.description}</p>
            <div className="mkt-hero-actions">
              <Link className="mkt-button" href="/sign-up">
                {home.primaryCta} <span aria-hidden="true">↗</span>
              </Link>
              <a href="#process">
                {home.secondaryCta} <span aria-hidden="true">↓</span>
              </a>
            </div>
            <p className="mkt-scale-note">{home.scaleNote}</p>
          </div>
          <figure className="mkt-journey">
            <figcaption>
              {locale === "ar" ? "رحلة الحملة" : "The campaign path"}
            </figcaption>
            <svg viewBox="0 0 540 520" aria-hidden="true" focusable="false">
              <path
                id="mkt-journey-route"
                className="mkt-route"
                d="M100 102 C200 100 315 123 410 180 C485 225 335 325 130 338 C80 345 205 432 425 443"
              />
              <path
                className="mkt-route-live"
                d="M100 102 C200 100 315 123 410 180 C485 225 335 325 130 338 C80 345 205 432 425 443"
              />
              <circle className="mkt-traveler" r="8">
                <animateMotion dur="9s" repeatCount="indefinite">
                  <mpath href="#mkt-journey-route" />
                </animateMotion>
              </circle>
              {[
                [100, 102],
                [410, 180],
                [130, 338],
                [425, 443],
              ].map(([x, y], i) => (
                <g key={i}>
                  <circle className="mkt-node-halo" cx={x} cy={y} r="29" />
                  <circle className="mkt-node" cx={x} cy={y} r="12" />
                </g>
              ))}
            </svg>
            <ol className="mkt-journey-stops">
              {[
                home.metrics[1]?.value,
                home.metrics[2]?.value,
                locale === "ar" ? "قالب معتمد" : "Approved template",
                home.metrics[3]?.value,
              ].map((label, i) => (
                <li key={i}>
                  <span>0{i + 1}</span>
                  <strong>{label}</strong>
                </li>
              ))}
            </ol>
          </figure>
        </div>
      </section>

      <section id="process" className="mkt-process">
        <div className="mkt-container mkt-split">
          <div className="mkt-section-intro">
            <p className="mkt-section-label">01 / {home.howTitle}</p>
            <h2>{home.featureTitle}</h2>
            <p>{home.featureIntro}</p>
          </div>
          <ol className="mkt-process-list">
            {home.how.map((step, i) => (
              <li key={step.title}>
                <span>0{i + 1}</span>
                <div>
                  <h3>{step.title.replace(/^\d+\.\s*/, "")}</h3>
                  <p>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="platform" className="mkt-capabilities">
        <div className="mkt-container">
          <div className="mkt-capabilities-heading">
            <p className="mkt-section-label">
              02 /{" "}
              {locale === "ar" ? "داخل مساحة العمل" : "Inside the workspace"}
            </p>
            <h2>
              {locale === "ar"
                ? "كل مرحلة لها مكانها."
                : "Every part of the campaign has a place."}
            </h2>
          </div>
          <div className="mkt-capabilities-list">
            {home.features.map((feature, i) => (
              <article key={feature.title}>
                <span>0{i + 1}</span>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mkt-trust">
        <div className="mkt-container mkt-split">
          <div>
            <p className="mkt-section-label">03 / Meta</p>
            <h2>{home.metaTitle}</h2>
            <p>{home.metaBody}</p>
          </div>
          <div>
            <p className="mkt-section-label">
              04 / {locale === "ar" ? "الموافقة" : "Permission"}
            </p>
            <h2>{home.trustTitle}</h2>
            <p>{home.trustBody}</p>
          </div>
        </div>
      </section>

      <section className="mkt-final">
        <div className="mkt-container">
          <p className="mkt-section-label">{home.eyebrow}</p>
          <h2>{home.ctaTitle}</h2>
          <div>
            <p>{home.ctaBody}</p>
            <Link className="mkt-button" href="/sign-up">
              {home.primaryCta} <span aria-hidden="true">↗</span>
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

export function MarketingContentPage({
  locale,
  slug,
}: {
  locale: Locale;
  slug: MarketingSlug;
}) {
  const page = getMarketingCopy(locale).pages[slug];
  return (
    <>
      <section className="mkt-page-hero">
        <div className="mkt-container">
          <p className="mkt-section-label">{page.eyebrow}</p>
          <h1>{page.title}</h1>
          <p>{page.description}</p>
        </div>
      </section>
      <section className="mkt-container mkt-content-stack">
        {page.sections.map((section) => (
          <article className="mkt-content-section" key={section.title}>
            <h2>{section.title}</h2>
            <p>{section.body}</p>
            {section.items ? (
              <ul>
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
          </article>
        ))}
      </section>
    </>
  );
}
