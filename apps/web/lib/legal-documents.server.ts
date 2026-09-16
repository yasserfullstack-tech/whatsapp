import type { Locale } from "./i18n";
import {
  LEGAL_DOCUMENTS,
  LEGAL_EFFECTIVE_DATE,
  isLegalDocumentSlug,
  legalDocumentsApproved,
  type LegalDocumentSlug,
} from "./legal";

export type LegalSection = {
  title: string;
  body: string;
  items?: string[];
};

export type LegalDocumentContent = {
  slug: LegalDocumentSlug;
  title: string;
  description: string;
  eyebrow: string;
  version: string;
  effectiveDate: string;
  approved: boolean;
  sections: LegalSection[];
};

type LegalEntityDetails = {
  entityName: string;
  entityAddress: string;
  privacyEmail: string;
  abuseEmail: string;
  supportEmail: string;
  hostingRegion: string;
  governingLaw: string;
  disputeForum: string;
};

const REQUIRED_APPROVAL_FIELDS = [
  "LEGAL_ENTITY_NAME",
  "LEGAL_ENTITY_ADDRESS",
  "PRIVACY_CONTACT_EMAIL",
  "ABUSE_CONTACT_EMAIL",
  "SUPPORT_CONTACT_EMAIL",
  "LEGAL_HOSTING_REGION",
  "LEGAL_GOVERNING_LAW",
  "LEGAL_DISPUTE_FORUM",
] as const;

function configured(name: (typeof REQUIRED_APPROVAL_FIELDS)[number], fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function getLegalEntityDetails(): LegalEntityDetails {
  const approved = legalDocumentsApproved();
  if (approved) {
    const missing = REQUIRED_APPROVAL_FIELDS.filter((name) => !process.env[name]?.trim());
    if (missing.length) {
      throw new Error(`Approved legal documents require production configuration: ${missing.join(", ")}`);
    }
  }

  return {
    entityName: configured("LEGAL_ENTITY_NAME", "[contracting entity pending counsel approval]"),
    entityAddress: configured("LEGAL_ENTITY_ADDRESS", "[registered address pending counsel approval]"),
    privacyEmail: configured("PRIVACY_CONTACT_EMAIL", "[privacy contact pending production configuration]"),
    abuseEmail: configured("ABUSE_CONTACT_EMAIL", "[abuse contact pending production configuration]"),
    supportEmail: configured("SUPPORT_CONTACT_EMAIL", "[support contact pending production configuration]"),
    hostingRegion: configured("LEGAL_HOSTING_REGION", "[production hosting region pending infrastructure approval]"),
    governingLaw: configured("LEGAL_GOVERNING_LAW", "[governing law pending counsel approval]"),
    disputeForum: configured("LEGAL_DISPUTE_FORUM", "[dispute forum pending counsel approval]"),
  };
}

function terms(details: LegalEntityDetails): LegalSection[] {
  return [
    {
      title: "1. Contracting party and agreement",
      body: `These Terms govern access to the WhatsApp Campaigns service provided by ${details.entityName}, ${details.entityAddress}. By creating or using an account, the customer agrees to these Terms, the Acceptable Use Policy, and the Anti-Spam Policy. A person accepting for an organization represents that they have authority to bind that organization.`,
    },
    {
      title: "2. Service and third-party platform dependencies",
      body: "The service helps customers manage contacts, audiences, WhatsApp templates, campaign execution, delivery events, and related operational workflows. Meta and WhatsApp are independent third-party platforms. Their policies, account decisions, availability, quality ratings, pricing, throughput, and product changes can affect the service and are not controlled by us.",
    },
    {
      title: "3. Customer responsibilities",
      body: "The customer is responsible for its content, contact data, connected business assets, users, and messaging instructions. The customer must have the permissions and lawful basis required to process contact data and send each communication, must honor opt-outs and suppressions, and must comply with applicable law and Meta/WhatsApp policies.",
      items: [
        "Do not upload purchased, scraped, harvested, or unlawfully obtained recipient lists.",
        "Do not use the service to evade platform enforcement or sender-quality controls.",
        "Keep account credentials secure and promptly report suspected unauthorized access.",
      ],
    },
    {
      title: "4. Fees, billing, cancellation, refunds, and disputes",
      body: "Subscription fees, usage limits, billing intervals, taxes, renewal terms, cancellation timing, and any refund entitlement are those presented in the applicable order, checkout, or commercial agreement. Meta/WhatsApp charges are separate unless an order expressly says otherwise. The production billing policy must be aligned with the implemented billing provider before this document is approved. Billing questions or disputes should be sent to the support contact below without limiting any non-waivable statutory rights.",
    },
    {
      title: "5. Suspension and termination",
      body: "We may restrict, suspend, or terminate access when reasonably necessary to address security risk, abuse, non-payment, legal obligations, repeated policy violations, or Meta/WhatsApp restrictions. Where appropriate, we will use the documented suspension/reactivation procedure and provide a route to contact support. Customers may stop using the service and cancel according to their subscription terms.",
    },
    {
      title: "6. Data protection and confidentiality",
      body: "Each party must protect confidential information using reasonable safeguards and use it only for the relationship. Data-protection responsibilities are described in the Privacy Policy and, where applicable, the Data Processing Addendum. Customers remain responsible for instructions they give us regarding customer-controlled contact and campaign data.",
    },
    {
      title: "7. Intellectual property",
      body: "Customers retain rights in their content and data. They grant the limited rights necessary to host, process, transmit, and otherwise handle that material to provide and secure the service. We and our licensors retain rights in the service, software, documentation, branding, and improvements, excluding customer content and data.",
    },
    {
      title: "8. Warranties and service availability",
      body: "The service is provided subject to the express commitments in an applicable order or agreement. Except where law does not allow exclusion, implied warranties are disclaimed to the maximum lawful extent. No fixed WhatsApp delivery time, recipient reach, sender quality, or uninterrupted third-party availability is guaranteed unless expressly agreed in writing.",
    },
    {
      title: "9. Liability",
      body: "Any exclusions, liability cap, excluded loss categories, indemnities, and exceptions must be finalized by qualified counsel for the contracting entity and governing law before these Terms are marked approved. Nothing in these Terms excludes liability that cannot lawfully be excluded.",
    },
    {
      title: "10. Governing law and disputes",
      body: `These Terms are intended to be governed by ${details.governingLaw}, with disputes handled in ${details.disputeForum}, subject to any mandatory consumer or statutory rights that cannot be varied by contract. These provisions must be confirmed by counsel before approval.`,
    },
    {
      title: "11. Changes, versioning, and contact",
      body: `Material legal-document versions are identified by version and effective date. The application records acceptance of the exact required version before normal workspace access. Material updates require renewed acceptance. Support contact: ${details.supportEmail}.`,
    },
  ];
}

function privacy(details: LegalEntityDetails): LegalSection[] {
  return [
    {
      title: "1. Scope and roles",
      body: `${details.entityName} processes account, security, billing, support, and service-operations data for its own service administration purposes. For contact lists, campaign content, consent records, and other data a customer submits about recipients, the customer generally determines the purpose and means of processing and we process that data on the customer's documented instructions, subject to the final DPA and applicable law.`,
    },
    {
      title: "2. Data we process",
      body: "Depending on use of the service, we may process account identity and authentication data; organization membership and roles; connected WhatsApp Business identifiers; contact details; consent and suppression history; templates and campaign configuration; delivery and webhook events; billing and subscription records; support communications; security events; device/session metadata; and operational logs.",
    },
    {
      title: "3. Why we process data",
      body: "We process data to provide and secure the service, authenticate users, operate customer workspaces, execute customer instructions, synchronize provider state, send service communications, bill for paid services, prevent abuse, troubleshoot incidents, comply with law, and improve reliability. The applicable legal basis depends on the data, relationship, and jurisdiction and must be confirmed in the approved policy.",
    },
    {
      title: "4. Customer responsibilities for recipient data",
      body: "Customers are responsible for providing required notices, obtaining any required consent or other lawful basis, honoring recipient choices, and ensuring that uploaded data and messaging instructions are lawful. We provide suppression and consent-history controls, but those controls do not replace the customer's legal obligations.",
    },
    {
      title: "5. Service providers and platform recipients",
      body: "We use service providers for infrastructure, object storage, transactional email, monitoring, and other production functions. The maintained subprocessor register is in docs/legal/subprocessors.md and must match the production environment before approval. Meta/WhatsApp receives data necessary to operate the WhatsApp Business Platform under its own terms and policies; counsel must confirm the correct controller/processor characterization for that relationship.",
    },
    {
      title: "6. Hosting and international transfers",
      body: `The intended production hosting/data region is ${details.hostingRegion}. If data is transferred across jurisdictions, the production service must use any contractual or other transfer safeguards required by applicable law. The deployment evidence and subprocessor register must identify the actual regions used.`,
    },
    {
      title: "7. Retention",
      body: "Workspace retention controls currently default to 30 days for processed raw webhook rows, 7 days for import files, 24 hours for generated export files, 365 days for workspace audit events, and 365 days for historical campaign-recipient records. Some security, billing, legal, or platform audit records may require separate retention. Workspace and account deletion follow the documented cooling-off, purge, and audit procedures in docs/data-lifecycle.md.",
    },
    {
      title: "8. Security",
      body: "The service uses authentication and session controls, organization-scoped authorization, encrypted credential storage, webhook signature validation, private object storage flows, audit logging for sensitive operations, and other safeguards documented in the repository. Security measures evolve over time; we do not claim certifications or independent attestations that have not actually been obtained.",
    },
    {
      title: "9. Privacy rights and requests",
      body: `Depending on applicable law, individuals may have rights to access, correct, delete, restrict, object to, or receive a copy of personal data. Requests concerning a customer's recipient data should normally be directed to that customer first because it controls that data. Requests concerning account/service data can be sent to ${details.privacyEmail}. We may verify identity and authority before acting.`,
    },
    {
      title: "10. Deletion and exports",
      body: "Authorized workspace users can request supported data exports. Workspace owners can request workspace deletion with confirmation and a cooling-off period; account deletion has separate safeguards. Backup and legally required retention may delay final erasure where permitted by law, and durable lifecycle audit evidence may be retained to prove the request and outcome.",
    },
    {
      title: "11. Contact and policy changes",
      body: `Privacy contact: ${details.privacyEmail}. Support contact: ${details.supportEmail}. Material versions of this policy are identified by version and effective date; when a new version requires acceptance, the application records the exact accepted version and timestamp.`,
    },
  ];
}

function acceptableUse(details: LegalEntityDetails): LegalSection[] {
  return [
    {
      title: "1. Permission-based lawful use",
      body: "Use the service only for lawful business communications to recipients you are permitted to contact. You must comply with applicable communications, privacy, consumer-protection, advertising, and data-protection rules as well as Meta and WhatsApp policies.",
    },
    {
      title: "2. Prohibited content and conduct",
      body: "You may not use the service for unlawful activity, fraud, deception, harassment, threats, hate or exploitation, phishing, credential theft, malware, impersonation, rights infringement, evasion of platform enforcement, or conduct that creates material security or abuse risk.",
    },
    {
      title: "3. Prohibited recipient acquisition",
      body: "Do not send campaigns to purchased, rented, scraped, harvested, randomly generated, or otherwise unsolicited lists. Do not fabricate consent evidence, re-add opted-out recipients without a documented valid resubscription, or conceal the identity of the sender.",
    },
    {
      title: "4. Security and platform integrity",
      body: "Do not probe, disrupt, overload, bypass access controls, reverse engineer where prohibited, share credentials improperly, or use automation intended to defeat service or provider limits. Report suspected vulnerabilities through the published support/security channel rather than exploiting them.",
    },
    {
      title: "5. Enforcement",
      body: `We may investigate credible reports and may pause campaigns, restrict functionality, suspend a workspace, or terminate access when proportionate to the risk or required by law/provider policy. Abuse reports should be sent to ${details.abuseEmail}. Reactivation follows the documented review procedure and may require remediation evidence.`,
    },
  ];
}

function antiSpam(details: LegalEntityDetails): LegalSection[] {
  return [
    {
      title: "1. Permission first",
      body: "Every campaign must have the permission or other lawful basis required for the recipient, message type, and jurisdiction, and must comply with WhatsApp messaging rules. Campaign size never removes the permission requirement.",
    },
    {
      title: "2. Consent evidence",
      body: "Customers should retain evidence showing when, how, and for what messaging purpose a recipient opted in or otherwise became eligible. Imported contacts should include accurate consent context where available. Do not infer permission merely because a phone number is public or appears in a purchased database.",
    },
    {
      title: "3. Sender identification and message expectations",
      body: "Messages must accurately identify the business and should match the purpose the recipient reasonably expects. Use approved templates where required and do not use misleading names, domains, offers, or identity information.",
    },
    {
      title: "4. Opt-outs and suppression",
      body: "Honor unsubscribe and do-not-contact requests promptly. Suppressed contacts must remain ineligible for normal campaign sending unless a later, documented event establishes a valid new basis to contact them. Suppression disputes must be investigated without deleting evidence needed to understand the history.",
    },
    {
      title: "5. Quality monitoring",
      body: "Monitor failures, blocks, complaints, negative feedback, and Meta quality/restriction signals. Pause or reduce sending when signals indicate recipient harm, stale consent, policy violations, or sender-quality deterioration. Provider restrictions must not be bypassed by switching assets to evade enforcement.",
    },
    {
      title: "6. Reporting spam or abuse",
      body: `Reports can be sent to ${details.abuseEmail}. Include the sender identity, relevant phone number or business name, approximate time, and enough context to investigate. We will follow the documented abuse and consent-dispute runbooks and preserve a proportionate audit trail.`,
    },
  ];
}

export function getLegalDocument(locale: Locale, slug: string): LegalDocumentContent | null {
  if (!isLegalDocumentSlug(slug)) return null;
  const descriptor = LEGAL_DOCUMENTS.find((document) => document.slug === slug)!;
  const details = getLegalEntityDetails();
  const approved = legalDocumentsApproved();
  const languageNote = locale === "ar"
    ? "The legally operative draft is currently maintained in English; obtain counsel-reviewed Arabic text before representing an Arabic translation as authoritative."
    : "This version is maintained in English and requires the recorded approval described below before production acceptance is enabled.";

  const base = {
    slug,
    version: descriptor.version,
    effectiveDate: LEGAL_EFFECTIVE_DATE,
    approved,
    eyebrow: "Legal & compliance",
  } as const;

  switch (slug) {
    case "terms":
      return {
        ...base,
        title: "Terms of Service",
        description: `${languageNote} These Terms describe the service relationship, customer responsibilities, billing boundaries, suspension, liability placeholders requiring counsel confirmation, and versioned acceptance.`,
        sections: terms(details),
      };
    case "privacy":
      return {
        ...base,
        title: "Privacy Policy",
        description: `${languageNote} This policy explains the service's data roles, data categories, purposes, providers, retention, rights, deletion, and production disclosure requirements.`,
        sections: privacy(details),
      };
    case "acceptable-use":
      return {
        ...base,
        title: "Acceptable Use Policy",
        description: `${languageNote} This policy defines prohibited abuse, recipient-acquisition restrictions, security expectations, and enforcement boundaries.`,
        sections: acceptableUse(details),
      };
    case "anti-spam":
      return {
        ...base,
        title: "Anti-Spam Policy",
        description: `${languageNote} This policy requires permission-based messaging, consent evidence, prompt opt-outs, suppression, and quality monitoring.`,
        sections: antiSpam(details),
      };
  }
}
