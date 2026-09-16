# Subprocessor and platform register

**Status:** Production verification required before legal approval. This register is based on integrations present in the repository and must be reconciled against the actual deployed environment for PR-009 before launch.

Do not list a vendor merely because an SDK is installed. Do not omit a production provider that processes customer personal data merely because it is configured outside Git.

| Provider / component | Purpose | Data categories | Region / transfer notes | Status before launch |
| --- | --- | --- | --- | --- |
| Production hosting provider | Runs web/API/worker, PostgreSQL, Valkey and related infrastructure unless those services are separately managed | Account data, workspace data, contacts, campaigns, operational metadata | Must match `LEGAL_HOSTING_REGION` and PR-009 deployment evidence | **Provider not yet recorded in this repository** |
| Cloudflare R2 | Private object storage for contact-import files and generated data exports | Imported contact data, export data, object metadata | Actual bucket location/jurisdiction and contractual transfer terms must be verified | Integration exists; production account/bucket evidence required |
| Resend | Transactional authentication and notification email when configured | User email address, message subject/body, delivery metadata | Verify production account, processing locations, DPA/terms, and retention | Integration exists; production evidence required |
| Sentry | Optional application error/telemetry reporting when production DSN is configured | Error context, request/application metadata; configuration must avoid unnecessary message/contact data | Verify production project region/settings, scrubbing, retention, and contract | Optional integration; production use must be confirmed |

## Meta / WhatsApp platform relationship

Meta/WhatsApp is a required external platform recipient/dependency for WhatsApp Business messaging. The application transmits data needed to onboard business assets, synchronize WhatsApp state, and send customer-authorized messages through Meta's APIs.

Do **not** automatically label Meta a "subprocessor" in customer contracts. Qualified counsel must confirm whether Meta acts as an independent controller, processor/subprocessor, or other role for each relevant processing activity under the selected WhatsApp Business setup and jurisdiction. The approved Privacy Policy/DPA must use that reviewed characterization.

## Infrastructure components that are not automatically separate subprocessors

PostgreSQL, Valkey/Redis-compatible storage, Caddy, Prometheus, and Grafana appear in the deployment architecture. When these run on infrastructure controlled by the same hosting provider, the relevant external vendor is generally the hosting/infrastructure provider rather than the software project itself. If any component is purchased as a separately managed service, add that service provider to this register.

## Change procedure

Before adding or materially changing a provider that processes customer personal data:

1. Identify the processing purpose, data categories, access level, and expected region(s).
2. Complete security/privacy/vendor review appropriate to risk.
3. Confirm contractual data-protection terms and any required transfer mechanism.
4. Update this register and the public Privacy Policy where necessary.
5. Follow any customer notice/objection process required by the approved DPA or applicable law.
6. Record the effective date and reviewer in the private vendor/compliance record.

## Pre-launch verification checklist

- [ ] Record the actual production hosting provider and data region(s).
- [ ] Verify the production Cloudflare R2 account/bucket and relevant region/contract terms.
- [ ] Verify whether Resend is enabled in production and record its processing terms/settings.
- [ ] Verify whether Sentry is enabled in production and record region, retention, and scrubbing settings.
- [ ] Confirm Meta/WhatsApp legal-role language with qualified counsel.
- [ ] Confirm no additional production vendors process customer personal data.
- [ ] Reconcile this register with PR-009 production infrastructure evidence.
- [ ] Record counsel/privacy approval in issue #53 before marking PR-008 complete.
