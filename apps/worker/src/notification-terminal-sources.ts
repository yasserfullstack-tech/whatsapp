import { and, eq, gte, inArray } from "drizzle-orm";
import { schema } from "@wa/db";
import {
  type Database,
  type NotificationEmitter,
} from "./notification-source-utils";

export async function emitCampaignTerminalNotification(
  db: Database,
  notifications: NotificationEmitter,
  campaignId: string,
): Promise<number> {
  const campaign = (
    await db
      .select({
        id: schema.campaigns.id,
        organizationId: schema.campaigns.organizationId,
        name: schema.campaigns.name,
        status: schema.campaigns.status,
      })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1)
  )[0];
  if (!campaign || (campaign.status !== "completed" && campaign.status !== "failed")) return 0;

  const result = await notifications.emit({
    id: `campaign:${campaign.id}:${campaign.status}`,
    type: campaign.status === "completed" ? "campaign_completed" : "campaign_failed",
    organizationId: campaign.organizationId,
    metadata: { campaignId: campaign.id, campaignName: campaign.name },
    link: `/campaigns/${campaign.id}`,
  });
  return result.notificationsCreated;
}

/**
 * Terminal contact-import notification shared by the BullMQ completion hook and
 * the durable reconciliation pass. See {@link emitCampaignTerminalNotification}.
 */
export async function emitImportTerminalNotification(
  db: Database,
  notifications: NotificationEmitter,
  importId: string,
): Promise<number> {
  const contactImport = (
    await db
      .select({
        id: schema.contactImports.id,
        organizationId: schema.contactImports.organizationId,
        fileName: schema.contactImports.originalFileName,
        status: schema.contactImports.status,
        importedRows: schema.contactImports.importedRows,
        invalidRows: schema.contactImports.invalidRows,
        errorMessage: schema.contactImports.errorMessage,
      })
      .from(schema.contactImports)
      .where(eq(schema.contactImports.id, importId))
      .limit(1)
  )[0];
  if (!contactImport || (contactImport.status !== "completed" && contactImport.status !== "failed")) return 0;

  const result = await notifications.emit({
    id: `import:${contactImport.id}:${contactImport.status}`,
    type: contactImport.status === "completed" ? "import_completed" : "import_failed",
    organizationId: contactImport.organizationId,
    metadata: {
      importId: contactImport.id,
      fileName: contactImport.fileName,
      importedRows: contactImport.importedRows,
      invalidRows: contactImport.invalidRows,
      ...(contactImport.errorMessage ? { detail: contactImport.errorMessage } : {}),
    },
    link: "/contacts",
  });
  return result.notificationsCreated;
}

export async function emitCampaignTerminalStates(db: Database, notifications: NotificationEmitter, since: Date): Promise<number> {
  const rows = await db
    .select({ id: schema.campaigns.id })
    .from(schema.campaigns)
    .where(and(
      inArray(schema.campaigns.status, ["completed", "failed"]),
      gte(schema.campaigns.updatedAt, since),
    ));

  let emitted = 0;
  for (const row of rows) {
    emitted += await emitCampaignTerminalNotification(db, notifications, row.id);
  }
  return emitted;
}

/**
 * Replays contact-import completions.
 *
 * Only `completed` rows are replayed. `processContactImport` writes
 * `status = "failed"` before rethrowing on *every* attempt, so a `failed` row is
 * not necessarily terminal while the contact-import queue still has retries
 * left. Replaying it here could announce a failure that a later retry turns into
 * a success. Import failures are therefore emitted only by the queue hook in
 * `notification-runtime.ts`, which checks `attemptsMade >= attempts` first.
 */
export async function emitImportCompletionStates(db: Database, notifications: NotificationEmitter, since: Date): Promise<number> {
  const rows = await db
    .select({ id: schema.contactImports.id })
    .from(schema.contactImports)
    .where(and(
      eq(schema.contactImports.status, "completed"),
      gte(schema.contactImports.updatedAt, since),
    ));

  let emitted = 0;
  for (const row of rows) {
    emitted += await emitImportTerminalNotification(db, notifications, row.id);
  }
  return emitted;
}
