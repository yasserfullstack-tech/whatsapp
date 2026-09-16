# Legal and compliance package

This directory contains the repository-side deliverables for **PR-008 — Finalize legal documents and compliance procedures** from [`docs/production-readiness-plan.md`](../production-readiness-plan.md) and tracking issue [#53](https://github.com/yasserfullstack-tech/whatsapp/issues/53).

## Status

The documents in this branch are **production-oriented drafts prepared for qualified legal review**. They are not represented as approved legal advice or executed agreements. The application intentionally blocks production acceptance while `LEGAL_DOCUMENTS_APPROVED=false`.

PR-008 must remain unchecked until the required legal review/approval record is attached to issue #53 and the production-specific entity, contact, hosting-region, governing-law, and dispute fields have been configured.

## Versioned customer acceptance

The application defines one current version for each required customer-facing document in `apps/web/lib/legal.ts`:

- Terms of Service.
- Privacy Policy.
- Acceptable Use Policy.
- Anti-Spam Policy.

`legal_acceptances` stores the authenticated user, document type, exact version, acceptance timestamp, source, and user agent. Normal workspace access checks those records. A version change therefore requires a new acceptance record rather than overwriting historical evidence.

Production users cannot accept draft documents. `LEGAL_DOCUMENTS_APPROVED=true` is the operational switch that permits production acceptance, and the public legal-document loader refuses an approved state unless every required production disclosure field is configured.

## Documents and procedures

- [`dpa.md`](dpa.md) — Data Processing Addendum template for counsel review and customer execution where applicable.
- [`subprocessors.md`](subprocessors.md) — production subprocessor/platform register and pre-launch verification requirements.
- [`compliance-runbooks.md`](compliance-runbooks.md) — abuse, consent/suppression, privacy request, deletion, suspension/reactivation, and Meta restriction procedures.
- [`legal-review-checklist.md`](legal-review-checklist.md) — approval/evidence checklist that must be completed before enabling production acceptance.
- [`../data-lifecycle.md`](../data-lifecycle.md) — implemented export, retention, workspace deletion, and account deletion controls.

## Interim owners

Until delegated in issue #53, `@yasserfullstack-tech` is the accountable owner for privacy intake, abuse/compliance intake, support escalation, data-subject requests, deletion escalations, customer suspension/reactivation, and Meta quality/restriction escalation.

Operational ownership must be updated here and in issue #53 when responsibilities are delegated. A generic mailbox alone is not an owner.

## Production configuration

The following values are intentionally externalized instead of inventing company or jurisdiction details in source code:

- `LEGAL_ENTITY_NAME`
- `LEGAL_ENTITY_ADDRESS`
- `PRIVACY_CONTACT_EMAIL`
- `ABUSE_CONTACT_EMAIL`
- `SUPPORT_CONTACT_EMAIL`
- `LEGAL_HOSTING_REGION`
- `LEGAL_GOVERNING_LAW`
- `LEGAL_DISPUTE_FORUM`
- `LEGAL_DOCUMENTS_APPROVED`

Do not set `LEGAL_DOCUMENTS_APPROVED=true` merely because the code or drafts were merged. Record qualified legal approval and production disclosures first.
