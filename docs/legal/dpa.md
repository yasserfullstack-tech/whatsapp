# Data Processing Addendum — review template

**Status:** Draft for qualified legal review. This document is not an executed DPA and must not be represented as approved until the approval evidence required by issue #53 is recorded.

This Data Processing Addendum ("DPA") is intended to supplement the applicable service agreement between the customer ("Customer") and the production contracting entity configured as `LEGAL_ENTITY_NAME` ("Provider") when Provider processes personal data on Customer's behalf.

## 1. Scope and roles

This DPA applies to personal data submitted to the service by or for Customer where Customer determines the purposes and means of processing and Provider processes that data to provide the service. Subject to applicable law and the final legal characterization:

- Customer acts as controller/business or equivalent decision-maker for customer-controlled recipient and campaign data.
- Provider acts as processor/service provider or equivalent for that data.
- Each party may act independently for data it processes for its own account, security, billing, legal compliance, or service-administration purposes.

If applicable law assigns different roles, those mandatory roles prevail.

## 2. Customer instructions

Provider will process covered personal data only on Customer's documented instructions, including instructions inherent in Customer's authorized use of the service, unless applicable law requires otherwise. If law permits, Provider will inform Customer before processing required by law.

Customer is responsible for ensuring its instructions are lawful and that it has provided required notices and obtained any required consent or other legal basis.

## 3. Processing details

**Subject matter:** operation of a WhatsApp campaign-management service and related support, security, storage, delivery, reporting, and data-lifecycle functions.

**Duration:** for the service term plus the deletion/retention periods in the agreement, Privacy Policy, and documented lifecycle controls.

**Nature and purpose:** storing and organizing contact data; recording consent/suppression state; preparing audiences; synchronizing templates and WhatsApp Business assets; executing customer-authorized campaigns; receiving delivery/provider events; reporting; support; security; exports; retention; and deletion.

**Categories of data subjects:** Customer users; Customer contacts and messaging recipients; and individuals appearing in Customer-provided content or support records.

**Categories of personal data:** names, phone numbers, contact attributes supplied by Customer, consent/suppression history, message/template variables, campaign participation and delivery events, WhatsApp identifiers, and related metadata. Customers must not intentionally use the service for special-category/sensitive data unless the service agreement and applicable safeguards expressly permit it.

## 4. Confidentiality and personnel

Provider will ensure personnel authorized to process covered personal data are subject to appropriate confidentiality obligations and receive access only as needed for their responsibilities.

## 5. Security measures

Provider will maintain reasonable technical and organizational safeguards appropriate to the service and risk. Current implemented controls include authenticated sessions, organization-scoped authorization, encrypted storage for Meta credentials, webhook signature validation, private object-storage flows, role controls, audit records for sensitive operations, and documented retention/deletion workflows.

Security measures may evolve. Provider will not represent a certification, audit, or penetration-test result that has not actually been completed and recorded.

## 6. Subprocessors

Customer authorizes Provider to use subprocessors necessary to provide the service, subject to the finalized notice/objection mechanism required by applicable law and the service agreement. The current production register is maintained in [`subprocessors.md`](subprocessors.md).

Provider will require subprocessors that process Customer personal data on Provider's behalf to protect that data through appropriate contractual obligations. Provider remains responsible for its subprocessor obligations to the extent required by the final agreement and applicable law.

## 7. Data-subject requests

Taking into account the nature of the processing, Provider will provide reasonable assistance for Customer to respond to applicable data-subject requests where Customer cannot fulfill the request using available product controls. Provider may require verification of Customer authority and may charge only where allowed by the final agreement and law.

## 8. Security incidents

Provider will notify Customer without undue delay after confirming a personal-data breach affecting covered Customer personal data when notification is required by applicable law or the final agreement. Notice should include information reasonably available about the nature of the incident, affected data, likely consequences, containment/remediation, and a contact point.

This section must be aligned with the production incident-response process and any jurisdiction-specific notification deadlines before approval.

## 9. Assistance and compliance information

Provider will provide reasonable information necessary to demonstrate compliance with processor obligations and will assist with data-protection impact assessments or regulator consultations to the extent required by applicable law, taking into account the nature of the service and information available to Provider.

Any audit right, frequency limit, confidentiality requirement, cost allocation, and third-party audit mechanism must be finalized by counsel before execution.

## 10. International transfers

If covered personal data is transferred to a jurisdiction that requires a transfer mechanism, the parties will use the applicable approved mechanism and supplementary measures where required. The actual production hosting/data region and subprocessor regions must be verified before this DPA is approved.

## 11. Return and deletion

At the end of the service, Provider will delete or return covered Customer personal data according to Customer instructions, product lifecycle controls, the service agreement, and applicable law. Data that must be retained for legal, security, fraud-prevention, billing, or audit purposes may be retained only for the applicable period and protected from unrelated use.

Workspace/account deletion behavior is documented in [`../data-lifecycle.md`](../data-lifecycle.md).

## 12. Conflict and changes

If this DPA conflicts with the main service agreement on covered processing obligations, the finalized DPA should control to the extent stated by counsel. Material DPA amendments must be versioned and, where required, communicated or executed through the approved contract process.

## Approval fields

These fields must be completed in the executed version or associated order:

- Provider legal name and address.
- Customer legal name and address.
- Effective date.
- Governing agreement/order.
- Applicable transfer mechanism(s), if any.
- Authorized signatories or acceptance mechanism.
- Counsel reviewer and approval record.
