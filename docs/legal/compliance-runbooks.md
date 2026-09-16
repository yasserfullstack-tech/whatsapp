# Compliance operating runbooks

These runbooks define the minimum operational response for PR-008. The interim accountable owner is `@yasserfullstack-tech` until a named replacement is recorded in issue #53 and this document.

Keep case records proportionate. Do not put passwords, access tokens, private keys, full payment credentials, or unnecessary recipient data into tickets or chat. Preserve evidence needed to understand decisions and actions.

## Common case record

For every compliance case record:

- case ID and category;
- received time and channel;
- requester/reporting party contact information where appropriate;
- affected workspace, sender, recipient, or account identifiers using the minimum data needed;
- allegation/request and supporting evidence;
- severity and immediate containment decision;
- owner and reviewers;
- actions taken with timestamps;
- customer communications;
- decision, rationale, and reactivation/remediation conditions where relevant;
- final closure time and any follow-up date.

## 1. Abuse reports

**Owner:** `@yasserfullstack-tech` (interim abuse/compliance owner).

1. Acknowledge the report through the published abuse channel.
2. Identify the affected workspace/sender without exposing unrelated tenant data.
3. Classify severity. Treat phishing, credential theft, malware, credible threats, large unsolicited sends, or active evasion as urgent.
4. Preserve relevant campaign, consent/suppression, delivery, audit, and Meta-status evidence.
5. Contain proportionately: pause a campaign, restrict sending, suspend the workspace, or revoke access where needed to stop ongoing harm.
6. Review the customer's permission evidence and the Acceptable Use and Anti-Spam policies.
7. Record the decision and required remediation. Escalate suspected crime, legal process, or material security incidents through the appropriate incident/legal path.
8. Reactivate only when the documented conditions are met and the risk is acceptably reduced.

Do not promise the reporter a specific sanction or disclose confidential customer information.

## 2. Suppression and consent disputes

**Owner:** `@yasserfullstack-tech` (interim compliance owner).

1. Identify the recipient and relevant sender/workspace using the minimum data required.
2. Immediately preserve the current suppression state and consent history. Do not delete disputed history merely to "fix" the record.
3. If permission is unclear or disputed, keep the recipient suppressed while investigating.
4. Review opt-in source, opt-in timestamp, resubscription events, unsubscribe events, import history, and campaign history.
5. Ask the customer for external consent evidence when repository evidence is insufficient.
6. Correct demonstrably inaccurate data while retaining an audit trail of the correction where supported.
7. A recipient may be made eligible again only after a documented, valid new basis to contact them exists.
8. Record outcome and notify the customer. Notify the recipient where appropriate and lawful.

## 3. Data-subject and privacy requests

**Owner:** `@yasserfullstack-tech` (interim privacy owner).

1. Determine whether the request concerns service/account data for which the platform acts on its own behalf or customer-controlled recipient data for which a customer is the primary decision-maker.
2. Record the date received and the applicable response deadline after legal review determines the relevant jurisdiction.
3. Verify identity and, where applicable, authority. Do not collect more verification data than reasonably necessary.
4. For customer-controlled recipient data, route the request to the relevant customer or assist the customer under the DPA, while avoiding unauthorized disclosure across tenants.
5. For account/service data, locate responsive data using authenticated exports and approved administrative procedures.
6. Review legal/security retention exceptions before deletion or restriction.
7. Deliver data securely and record what was provided, corrected, restricted, objected to, or deleted.
8. Escalate ambiguous requests, legal demands, complaints to regulators, or conflicts between customer instructions and law to qualified counsel.

## 4. Data deletion

**Owner:** `@yasserfullstack-tech` (interim privacy/operations owner).

Use the implemented procedures in [`../data-lifecycle.md`](../data-lifecycle.md) rather than ad-hoc SQL or object-store deletion.

- Workspace deletion is owner-only, requires a recent session and confirmation, has a seven-day cooling-off period, then a 24-hour suspension before purge.
- The purge verifies deletion of the workspace object-storage prefix before removing the organization row.
- Account deletion requires recent authentication and is blocked while the user still owns a workspace.
- Durable lifecycle audit evidence intentionally survives the tenant purge where documented.

For a privacy request requiring deletion of a narrower record, confirm tenant authorization and legal retention obligations before applying a targeted deletion or suppression. Preserve suppression data when needed to ensure an opted-out recipient is not contacted again, subject to legal review.

## 5. Customer suspension and reactivation

**Owner:** `@yasserfullstack-tech` (interim support/compliance owner).

Suspension can be considered for material abuse, security compromise, repeated consent violations, non-payment after the billing policy is finalized, legal requirements, or serious Meta/WhatsApp restrictions.

Before suspension, unless urgent containment is required:

1. Record the reason and evidence.
2. Confirm the actor is authorized to suspend the workspace.
3. Define what product functions are blocked and whether data export/support access remains available.
4. Notify the customer with the reason category, remediation steps when appropriate, and support route.

For reactivation:

1. Verify required remediation and any security credential changes.
2. Confirm Meta/provider restrictions no longer prevent safe operation where applicable.
3. Obtain compliance/support approval and record the decision.
4. Reactivate through the normal admin control, never by directly editing state without audit evidence.
5. Closely monitor the first campaigns after reactivation if the suspension involved messaging quality or abuse.

## 6. Meta quality or restriction escalation

**Owner:** `@yasserfullstack-tech` (interim Meta/compliance owner).

1. Capture the WABA/phone identifier, current local connection state, Meta quality/restriction status, timestamps, affected campaigns, and relevant error codes.
2. Stop or reduce sending when the connection is unusable, quality signals indicate material recipient harm, or Meta has restricted the asset.
3. Do not route around enforcement by onboarding substitute assets for the purpose of evasion.
4. Review recent campaign audience sources, consent evidence, opt-outs, failures, blocks, and complaint signals.
5. Follow Meta's current support/appeal process when an appeal is appropriate. Attach only data needed for the appeal and avoid secrets.
6. Record Meta case/reference IDs and responses in the internal case record.
7. Resume sending only when the asset is operational and the underlying quality/compliance concern has been remediated.

PR-004 and PR-005 remain the source of truth for automated synchronization and external Meta production evidence. This runbook does not prove that those tasks are complete.

## 7. Contacts and escalation matrix

Production mailboxes are configured through environment/secrets management rather than committed addresses:

- Privacy: `PRIVACY_CONTACT_EMAIL`
- Abuse/compliance: `ABUSE_CONTACT_EMAIL`
- Support/billing: `SUPPORT_CONTACT_EMAIL`

Before launch, confirm each mailbox is monitored, has an accountable human owner, and has a documented backup owner. Record qualified legal counsel and security-incident escalation details in the private operations system rather than this public repository when those details are confidential.
