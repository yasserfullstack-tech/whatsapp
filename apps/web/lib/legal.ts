export const LEGAL_EFFECTIVE_DATE = "2026-09-16";
export const LEGAL_VERSION = "2026-09-16-draft.1";

export const LEGAL_DOCUMENTS = [
  { type: "terms", slug: "terms", title: "Terms of Service", version: LEGAL_VERSION },
  { type: "privacy", slug: "privacy", title: "Privacy Policy", version: LEGAL_VERSION },
  { type: "acceptable_use", slug: "acceptable-use", title: "Acceptable Use Policy", version: LEGAL_VERSION },
  { type: "anti_spam", slug: "anti-spam", title: "Anti-Spam Policy", version: LEGAL_VERSION },
] as const;

export type LegalDocumentType = (typeof LEGAL_DOCUMENTS)[number]["type"];
export type LegalDocumentSlug = (typeof LEGAL_DOCUMENTS)[number]["slug"];
export type AcceptedLegalDocument = { documentType: string; documentVersion: string };

export function isLegalDocumentSlug(value: string): value is LegalDocumentSlug {
  return LEGAL_DOCUMENTS.some((document) => document.slug === value);
}

export function missingRequiredLegalDocuments(accepted: readonly AcceptedLegalDocument[]) {
  return LEGAL_DOCUMENTS.filter(
    (document) => !accepted.some(
      (row) => row.documentType === document.type && row.documentVersion === document.version,
    ),
  );
}

export function legalDocumentsApproved(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.LEGAL_DOCUMENTS_APPROVED === "true";
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost"
    || normalized.endsWith(".localhost")
    || normalized === "127.0.0.1"
    || normalized === "::1"
    || normalized === "[::1]";
}

export function shouldEnforceLegalAcceptance(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.E2E_BLOCK_EXTERNAL !== "1" || !env.BETTER_AUTH_URL) return true;

  try {
    return !isLoopbackHostname(new URL(env.BETTER_AUTH_URL).hostname);
  } catch {
    return true;
  }
}
