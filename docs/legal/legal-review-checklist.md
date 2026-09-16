# PR-008 legal review and approval checklist

Tracking issue: [#53](https://github.com/yasserfullstack-tech/whatsapp/issues/53)

This checklist separates repository implementation from external legal approval. **Do not set `LEGAL_DOCUMENTS_APPROVED=true`, check PR-008 complete, or describe the documents as counsel-approved until the external review items below have evidence.**

## Repository implementation

- [x] Substantive Terms of Service draft replaces the public placeholder page.
- [x] Substantive Privacy Policy draft replaces the public placeholder page.
- [x] Acceptable Use and Anti-Spam policies are published as versioned documents.
- [x] Data controller/processor responsibilities are described for counsel review.
- [x] DPA template exists.
- [x] Subprocessor/platform register exists.
- [x] Existing retention and deletion controls are incorporated by reference.
- [x] Abuse, consent/suppression, privacy request, deletion, suspension/reactivation, and Meta escalation runbooks are documented.
- [x] Customer legal acceptance is stored by exact document type/version and timestamp.
- [x] Normal workspace access requires current document acceptance.
- [x] Production acceptance is disabled while legal approval is pending.

## Production identity and contacts

- [ ] Confirm contracting legal entity name.
- [ ] Confirm registered/business address appropriate for the customer terms and privacy notice.
- [ ] Configure and test `PRIVACY_CONTACT_EMAIL`.
- [ ] Configure and test `ABUSE_CONTACT_EMAIL`.
- [ ] Configure and test `SUPPORT_CONTACT_EMAIL`.
- [ ] Assign primary and backup human owners for each mailbox/runbook.

## Privacy / data protection review

- [ ] Confirm controller/processor roles for account data, customer recipient data, support data, telemetry, and billing data.
- [ ] Review the DPA and determine where it applies.
- [ ] Confirm data-subject response obligations and jurisdiction-specific deadlines.
- [ ] Confirm retention periods and any statutory exceptions.
- [ ] Verify production hosting provider and `LEGAL_HOSTING_REGION` against PR-009 evidence.
- [ ] Reconcile all production vendors against `subprocessors.md`.
- [ ] Confirm international-transfer mechanisms where required.
- [ ] Confirm the legal characterization of Meta/WhatsApp for each relevant processing activity.
- [ ] Decide whether reviewed Arabic or other translated legal documents are required before launch.

## Commercial terms review

These items depend on PR-006 and the actual paid offering.

- [ ] Confirm subscription billing interval, renewal behavior, taxes, and invoice/payment flow.
- [ ] Confirm cancellation effective date and access after cancellation.
- [ ] Confirm refund policy and mandatory statutory refund rights where applicable.
- [ ] Confirm failed-payment handling and account restriction behavior.
- [ ] Confirm payment dispute/chargeback handling.
- [ ] Confirm whether Meta/WhatsApp fees are passed through, included, or billed separately.

## Terms / risk allocation review

- [ ] Confirm `LEGAL_GOVERNING_LAW`.
- [ ] Confirm `LEGAL_DISPUTE_FORUM` and any arbitration/court language.
- [ ] Finalize warranty disclaimers.
- [ ] Finalize limitation-of-liability cap and excluded-loss categories.
- [ ] Finalize indemnities, if any.
- [ ] Confirm IP/license language.
- [ ] Confirm suspension/termination rights and notice expectations.
- [ ] Confirm whether an SLA or service-credit schedule exists separately.

## Messaging compliance review

- [ ] Review Acceptable Use Policy against launch jurisdictions and Meta/WhatsApp rules.
- [ ] Review Anti-Spam Policy and consent evidence requirements.
- [ ] Align Meta quality/restriction escalation with PR-004 and PR-005 implementation/evidence.
- [ ] Confirm suppression data retention needed to honor opt-outs.
- [ ] Confirm abuse-report handling and any required regulator/law-enforcement escalation path.

## Approval record

Complete this section in issue #53 or attach an approved record there; do not place privileged legal advice in a public repository unless intentionally disclosed.

- Reviewer/counsel: **pending**
- Review date: **pending**
- Approved legal document version: **pending**
- Approved DPA version: **pending**
- Approved subprocessor register date: **pending**
- Evidence link/reference: **pending**

After the approval record exists and production-specific configuration is complete:

1. Replace the `-draft.N` legal version with the approved version/date as instructed by counsel.
2. Deploy the approved content and run the production acceptance flow.
3. Set `LEGAL_DOCUMENTS_APPROVED=true` through production secret/config management.
4. Verify a real customer/account records the exact approved document versions.
5. Attach evidence to issue #53.
6. Only then update `docs/production-readiness-plan.md` to mark PR-008 complete.
