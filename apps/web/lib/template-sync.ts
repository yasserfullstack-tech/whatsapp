import { schema } from "@wa/db";
import { extractTemplateBodyPreview, listMessageTemplates } from "@wa/meta";
import { db } from "./server";

export function normalizeTemplateCategory(category: string): "marketing" | "utility" | "authentication" {
  switch (category.toUpperCase()) {
    case "UTILITY":
      return "utility";
    case "AUTHENTICATION":
      return "authentication";
    default:
      return "marketing";
  }
}

export function normalizeTemplateStatus(status: string): "draft" | "pending" | "approved" | "rejected" | "paused" | "disabled" {
  switch (status.toUpperCase()) {
    case "APPROVED":
      return "approved";
    case "REJECTED":
      return "rejected";
    case "PAUSED":
      return "paused";
    case "DISABLED":
      return "disabled";
    case "DRAFT":
      return "draft";
    default:
      return "pending";
  }
}

export async function syncWabaTemplates(input: {
  organizationId: string;
  wabaId: string;
  accessToken: string;
  graphApiVersion: string;
}): Promise<number> {
  const remoteTemplates = await listMessageTemplates({
    wabaId: input.wabaId,
    accessToken: input.accessToken,
    graphApiVersion: input.graphApiVersion,
  });
  const now = new Date();

  await db.transaction(async (tx) => {
    for (const remote of remoteTemplates) {
      await tx
        .insert(schema.templates)
        .values({
          organizationId: input.organizationId,
          wabaId: input.wabaId,
          metaTemplateId: remote.id,
          name: remote.name,
          language: remote.language,
          category: normalizeTemplateCategory(remote.category),
          status: normalizeTemplateStatus(remote.status),
          metaStatus: remote.status,
          bodyPreview: extractTemplateBodyPreview(remote.components) ?? null,
          components: remote.components,
          rejectionReason: remote.rejectedReason ?? null,
          lastSyncedAt: now,
        })
        .onConflictDoUpdate({
          target: [schema.templates.organizationId, schema.templates.wabaId, schema.templates.name, schema.templates.language],
          set: {
            metaTemplateId: remote.id,
            category: normalizeTemplateCategory(remote.category),
            status: normalizeTemplateStatus(remote.status),
            metaStatus: remote.status,
            bodyPreview: extractTemplateBodyPreview(remote.components) ?? null,
            components: remote.components,
            rejectionReason: remote.rejectedReason ?? null,
            lastSyncedAt: now,
            updatedAt: now,
          },
        });
    }
  });

  return remoteTemplates.length;
}
