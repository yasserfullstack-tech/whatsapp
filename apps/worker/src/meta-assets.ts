export type MetaAssetVersion = {
  providerEventAt: Date;
  fingerprint: string;
};

export type LocalTemplateStatus = "draft" | "pending" | "approved" | "rejected" | "paused" | "disabled";
export type LocalConnectionStatus = "pending" | "connected" | "restricted" | "disconnected";

export function normalizeMetaTemplateStatus(status: string): LocalTemplateStatus {
  switch (status.trim().toUpperCase()) {
    case "APPROVED":
    case "REINSTATED":
      return "approved";
    case "REJECTED":
      return "rejected";
    case "PAUSED":
    case "FLAGGED":
      return "paused";
    case "DISABLED":
    case "DELETED":
      return "disabled";
    case "DRAFT":
      return "draft";
    default:
      return "pending";
  }
}

export function normalizeMetaTemplateCategory(category: string): "marketing" | "utility" | "authentication" {
  switch (category.trim().toUpperCase()) {
    case "UTILITY":
      return "utility";
    case "AUTHENTICATION":
      return "authentication";
    default:
      return "marketing";
  }
}

export function accountConnectionStatus(input: {
  event?: string;
  banState?: string;
}): "connected" | "restricted" | null {
  const banState = input.banState?.toUpperCase();
  if (banState === "FLAGGED" || banState === "DISABLE" || banState === "DISABLED") return "restricted";
  if (banState === "REINSTATE" || banState === "REINSTATED") return "connected";
  if (input.event?.toUpperCase() === "DISABLED_UPDATE" && !banState) return "restricted";
  return null;
}

export function accountPhoneStatusAfter(
  current: LocalConnectionStatus,
  incoming: "connected" | "restricted",
): LocalConnectionStatus {
  if (incoming === "restricted" && current === "connected") return "restricted";
  if (incoming === "connected" && current === "restricted") return "connected";
  return current;
}

export function normalizedPhoneDigits(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits || null;
}

export function matchingPhonesByDisplayNumber<T extends { displayPhoneNumber: string | null }>(
  phones: T[],
  displayPhoneNumber: string | undefined,
): T[] {
  const expected = normalizedPhoneDigits(displayPhoneNumber);
  if (!expected) return phones.length === 1 ? phones : [];
  return phones.filter((phone) => normalizedPhoneDigits(phone.displayPhoneNumber) === expected);
}

export function missingSynchronizedTemplateIds(
  localTemplates: Array<{ id: string; metaTemplateId: string | null }>,
  remoteTemplateIds: ReadonlySet<string>,
): string[] {
  return localTemplates
    .filter((template) => template.metaTemplateId && !remoteTemplateIds.has(template.metaTemplateId))
    .map((template) => template.id);
}

export function shouldApplyMetaAssetState(
  current: MetaAssetVersion | null | undefined,
  incomingAt: Date,
  incomingFingerprint: string,
): boolean {
  if (!current) return true;
  const incomingMs = incomingAt.getTime();
  const currentMs = current.providerEventAt.getTime();
  if (incomingMs < currentMs) return false;
  if (incomingMs === currentMs && current.fingerprint === incomingFingerprint) return false;
  return true;
}

export function stableFingerprint(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)));
  });
}

export function webhookEventTime(timestampSeconds: number | undefined, receiptTime: Date): Date {
  if (timestampSeconds !== undefined) {
    const date = new Date(timestampSeconds * 1_000);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return receiptTime;
}
