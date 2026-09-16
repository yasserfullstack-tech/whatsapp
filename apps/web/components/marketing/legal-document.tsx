import Link from "next/link";
import type { LegalDocumentContent } from "@/lib/legal-documents.server";

export function LegalDocumentPage({ document }: { document: LegalDocumentContent }) {
  return (
    <>
      <section className="mkt-page-hero">
        <div className="mkt-container mkt-narrow">
          <p className="mkt-eyebrow">{document.eyebrow}</p>
          <h1>{document.title}</h1>
          <p className="mkt-lead">{document.description}</p>
          <p>
            <strong>Version:</strong> {document.version} · <strong>Effective:</strong> {document.effectiveDate}
          </p>
          {!document.approved ? (
            <div className="mkt-content-section" role="status" style={{ marginTop: 20 }}>
              <strong>Draft — legal approval pending</strong>
              <p>
                This repository version is prepared for legal review. Production acceptance remains disabled until
                approval is recorded and the required entity, contact, region, governing-law, and dispute fields are configured.
              </p>
            </div>
          ) : null}
        </div>
      </section>
      <section className="mkt-section">
        <div className="mkt-container mkt-content-stack">
          {document.sections.map((section) => (
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
          <article className="mkt-content-section">
            <h2>Related policies</h2>
            <p>
              <Link href="/terms">Terms</Link> · <Link href="/privacy">Privacy</Link> ·{" "}
              <Link href="/acceptable-use">Acceptable use</Link> · <Link href="/anti-spam">Anti-spam</Link>
            </p>
          </article>
        </div>
      </section>
    </>
  );
}
