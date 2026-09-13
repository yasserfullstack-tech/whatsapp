import { randomUUID } from "node:crypto";

export const exportKinds = ["contacts", "campaign_recipients", "consent_history", "campaigns", "workspace"] as const;
export type ExportKind = (typeof exportKinds)[number];

export function isExportKind(value: unknown): value is ExportKind {
  return typeof value === "string" && (exportKinds as readonly string[]).includes(value);
}

export function safeExportSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "workspace";
}

export function createExportIdentity(organizationId: string, organizationSlug: string, kind: ExportKind, now = new Date()) {
  const id = randomUUID();
  const nonce = randomUUID();
  const date = now.toISOString().slice(0, 10);
  return {
    id,
    objectKey: `${organizationId}/data-exports/${id}/${nonce}.ndjson`,
    fileName: `${safeExportSlug(organizationSlug)}-${kind.replace(/_/g, "-")}-${date}.ndjson`,
  };
}

export function workspaceDeletionSchedule(now = new Date()) {
  const coolingOffEndsAt = new Date(now.getTime() + 7 * 86_400_000);
  const purgeAfter = new Date(coolingOffEndsAt.getTime() + 24 * 60 * 60 * 1_000);
  return { coolingOffEndsAt, purgeAfter };
}
