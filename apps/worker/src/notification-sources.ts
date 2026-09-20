import { and, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { createDatabase, schema } from "@wa/db";
import { NotificationService, type NotificationType } from "@wa/notifications";

type Database = ReturnType<typeof createDatabase>["db"];
type NotificationEmitter = Pick<NotificationService, "emit">;
type JsonRecord = Record<string, unknown>;

const PLATFORM_ACTIONS = [
  "meta.asset.template_status_changed",
  "meta.asset.template_reconciled",
  "meta.asset.phone_quality_reconciled",
  "meta.asset.waba_account_changed",
] as const;

const WORKSPACE_ACTIONS = [
  "whatsapp.disconnected",
  "workspace.member.role_changed",
  "workspace.member.removed",
  "workspace.ownership.transferred",
  "security.account.password_changed",
  "security.account.email_change_requested",
  "security.account.session_revoked",
  "security.account.other_sessions_revoked",
  "security.account.mfa_enabled",
  "security.account.mfa_disabled",
  "security.account.backup_codes_regenerated",
] as const;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function qualityRank(value: string | null | undefined): number | null {
  switch (value?.trim().toUpperCase()) {
    case "GREEN": return 3;
    case "YELLOW": return 2;
    case "RED": return 1;
    default: return null;
  }
}

export function isQualityDegraded(before: string | null | undefined, after: string | null | undefined): boolean {
  const previous = qualityRank(before);
  const next = qualityRank(after);
  return previous !== null && next !== null && next < previous;
}

export function templateNotificationType(status: string | null | undefined): NotificationType | null {
  switch (status?.trim().toLowerCase()) {
    case "approved": return "template_approved";
    case "rejected": return "template_rejected";
    default: return null;
  }
}

export function subscriptionNotificationType(toStatus: string | null | undefined): NotificationType {
  return toStatus === "past_due" || toStatus === "grace_period"
    ? "subscription_past_due"
    : "subscription_changed";
}

export function usagePercent(quantity: number, limit: number | null): number | null {
  if (limit === null || limit <= 0 || quantity < 0) return null;
  return Math.floor((quantity / limit) * 100);
}

/**
 * Terminal campaign notification shared by the BullMQ completion hook and the
 * durable reconciliation pass. Both callers use the same stable dedupe key, so
 * replaying a terminal campaign never produces a second notification.
 */
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

async function adminUserIds(db: Database, organizationId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: schema.organizationMembers.userId })
    .from(schema.organizationMembers)
    .where(and(
      eq(schema.organizationMembers.organizationId, organizationId),
      inArray(schema.organizationMembers.role, ["owner", "admin"]),
    ));
  return rows.map((row) => row.userId);
}

async function emitPlatformAuditEvents(db: Database, notifications: NotificationEmitter, since: Date): Promise<number> {
  const events = await db
    .select({
      id: schema.platformAuditEvents.id,
      organizationId: schema.platformAuditEvents.organizationId,
      action: schema.platformAuditEvents.action,
      targetId: schema.platformAuditEvents.targetId,
      metadata: schema.platformAuditEvents.metadata,
      createdAt: schema.platformAuditEvents.createdAt,
    })
    .from(schema.platformAuditEvents)
    .where(and(
      isNotNull(schema.platformAuditEvents.organizationId),
      gte(schema.platformAuditEvents.createdAt, since),
      inArray(schema.platformAuditEvents.action, [...PLATFORM_ACTIONS]),
    ));

  let emitted = 0;
  for (const event of events) {
    if (!event.organizationId) continue;
    const metadata = asRecord(event.metadata) ?? {};

    if (event.action === "meta.asset.template_status_changed" || event.action === "meta.asset.template_reconciled") {
      const after = asRecord(metadata.after);
      const type = templateNotificationType(asString(after?.status) ?? asString(metadata.status));
      if (!type) continue;
      const template = (
        await db
          .select({ name: schema.templates.name, rejectionReason: schema.templates.rejectionReason })
          .from(schema.templates)
          .where(and(
            eq(schema.templates.id, event.targetId),
            eq(schema.templates.organizationId, event.organizationId),
          ))
          .limit(1)
      )[0];
      const result = await notifications.emit({
        id: `platform-audit:${event.id}`,
        type,
        organizationId: event.organizationId,
        metadata: {
          templateId: event.targetId,
          templateName: template?.name,
          rejectionReason: template?.rejectionReason,
        },
        link: "/templates",
        occurredAt: event.createdAt,
      });
      emitted += result.notificationsCreated;
      continue;
    }

    if (event.action === "meta.asset.phone_quality_reconciled") {
      const before = asRecord(metadata.before);
      const after = asRecord(metadata.after);
      if (!isQualityDegraded(asString(before?.qualityRating), asString(after?.qualityRating))) continue;
      const phone = (
        await db
          .select({ displayPhoneNumber: schema.whatsappPhoneNumbers.displayPhoneNumber })
          .from(schema.whatsappPhoneNumbers)
          .where(and(
            eq(schema.whatsappPhoneNumbers.id, event.targetId),
            eq(schema.whatsappPhoneNumbers.organizationId, event.organizationId),
          ))
          .limit(1)
      )[0];
      const result = await notifications.emit({
        id: `platform-audit:${event.id}`,
        type: "quality_rating_degraded",
        organizationId: event.organizationId,
        userIds: await adminUserIds(db, event.organizationId),
        metadata: {
          phoneNumberId: event.targetId,
          phoneNumber: phone?.displayPhoneNumber,
          beforeRating: asString(before?.qualityRating),
          afterRating: asString(after?.qualityRating),
        },
        link: "/settings/whatsapp",
        occurredAt: event.createdAt,
      });
      emitted += result.notificationsCreated;
      continue;
    }

    if (event.action === "meta.asset.waba_account_changed" && asString(metadata.connectionStatus) === "restricted") {
      const result = await notifications.emit({
        id: `platform-audit:${event.id}`,
        type: "whatsapp_connection_problem",
        organizationId: event.organizationId,
        userIds: await adminUserIds(db, event.organizationId),
        metadata: {
          wabaId: event.targetId,
          detail: "Meta restricted this WhatsApp Business Account. Review the connection before sending.",
        },
        link: "/settings/whatsapp",
        occurredAt: event.createdAt,
      });
      emitted += result.notificationsCreated;
    }
  }
  return emitted;
}

function securityDetail(action: string): string {
  switch (action) {
    case "workspace.member.role_changed": return "A workspace member role was changed.";
    case "workspace.member.removed": return "A workspace member was removed.";
    case "workspace.ownership.transferred": return "Workspace ownership was transferred.";
    case "security.account.password_changed": return "Your account password was changed.";
    case "security.account.email_change_requested": return "An account email change was requested.";
    case "security.account.session_revoked": return "An account session was revoked.";
    case "security.account.other_sessions_revoked": return "Other account sessions were revoked.";
    case "security.account.mfa_enabled": return "Two-factor authentication was enabled.";
    case "security.account.mfa_disabled": return "Two-factor authentication was disabled.";
    case "security.account.backup_codes_regenerated": return "Two-factor recovery codes were regenerated.";
    default: return "A security-sensitive account change occurred.";
  }
}

async function emitWorkspaceAuditEvents(db: Database, notifications: NotificationEmitter, since: Date): Promise<number> {
  const events = await db
    .select({
      id: schema.workspaceAuditLogs.id,
      organizationId: schema.workspaceAuditLogs.organizationId,
      actorUserId: schema.workspaceAuditLogs.actorUserId,
      action: schema.workspaceAuditLogs.action,
      targetId: schema.workspaceAuditLogs.targetId,
      createdAt: schema.workspaceAuditLogs.createdAt,
    })
    .from(schema.workspaceAuditLogs)
    .where(and(
      gte(schema.workspaceAuditLogs.createdAt, since),
      inArray(schema.workspaceAuditLogs.action, [...WORKSPACE_ACTIONS]),
    ));

  let emitted = 0;
  for (const event of events) {
    if (event.action === "whatsapp.disconnected") {
      const phone = event.targetId ? (
        await db
          .select({ displayPhoneNumber: schema.whatsappPhoneNumbers.displayPhoneNumber })
          .from(schema.whatsappPhoneNumbers)
          .where(and(
            eq(schema.whatsappPhoneNumbers.id, event.targetId),
            eq(schema.whatsappPhoneNumbers.organizationId, event.organizationId),
          ))
          .limit(1)
      )[0] : null;
      const result = await notifications.emit({
        id: `workspace-audit:${event.id}`,
        type: "whatsapp_disconnected",
        organizationId: event.organizationId,
        userIds: await adminUserIds(db, event.organizationId),
        metadata: { phoneNumberId: event.targetId, phoneNumber: phone?.displayPhoneNumber },
        link: "/settings/whatsapp",
        occurredAt: event.createdAt,
      });
      emitted += result.notificationsCreated;
      continue;
    }

    const accountSpecific = event.action.startsWith("security.account.");
    const recipientIds = accountSpecific && event.actorUserId
      ? [event.actorUserId]
      : await adminUserIds(db, event.organizationId);
    const result = await notifications.emit({
      id: `workspace-audit:${event.id}`,
      type: "security_event",
      organizationId: event.organizationId,
      userIds: recipientIds,
      metadata: { detail: securityDetail(event.action), action: event.action },
      link: "/settings/security",
      occurredAt: event.createdAt,
    });
    emitted += result.notificationsCreated;
  }
  return emitted;
}

async function emitPaymentFailures(db: Database, notifications: NotificationEmitter, since: Date): Promise<number> {
  const events = await db
    .select({
      id: schema.billingProviderEvents.id,
      providerKey: schema.billingProviderEvents.providerKey,
      payload: schema.billingProviderEvents.payload,
      createdAt: schema.billingProviderEvents.createdAt,
    })
    .from(schema.billingProviderEvents)
    .where(and(
      eq(schema.billingProviderEvents.eventType, "invoice.payment_failed"),
      isNotNull(schema.billingProviderEvents.processedAt),
      gte(schema.billingProviderEvents.createdAt, since),
    ));

  let emitted = 0;
  for (const event of events) {
    const payload = asRecord(event.payload);
    const data = asRecord(payload?.data);
    const object = asRecord(data?.object);
    const providerInvoiceId = asString(object?.id);
    if (!providerInvoiceId) continue;
    const invoice = (
      await db
        .select({ id: schema.billingInvoices.id, organizationId: schema.billingInvoices.organizationId })
        .from(schema.billingInvoices)
        .where(and(
          eq(schema.billingInvoices.providerKey, event.providerKey),
          eq(schema.billingInvoices.providerInvoiceId, providerInvoiceId),
        ))
        .limit(1)
    )[0];
    if (!invoice) continue;
    const result = await notifications.emit({
      id: `billing-provider:${event.id}`,
      type: "billing_payment_failed",
      organizationId: invoice.organizationId,
      userIds: await adminUserIds(db, invoice.organizationId),
      metadata: { invoiceId: invoice.id, providerInvoiceId },
      link: "/settings/billing",
      occurredAt: event.createdAt,
    });
    emitted += result.notificationsCreated;
  }
  return emitted;
}

async function emitSubscriptionChanges(db: Database, notifications: NotificationEmitter, since: Date): Promise<number> {
  const changes = await db
    .select({
      id: schema.billingSubscriptionChanges.id,
      organizationId: schema.billingSubscriptionChanges.organizationId,
      subscriptionId: schema.billingSubscriptionChanges.subscriptionId,
      toPlanVersionId: schema.billingSubscriptionChanges.toPlanVersionId,
      fromStatus: schema.billingSubscriptionChanges.fromStatus,
      toStatus: schema.billingSubscriptionChanges.toStatus,
      kind: schema.billingSubscriptionChanges.kind,
      effectiveAt: schema.billingSubscriptionChanges.effectiveAt,
      createdAt: schema.billingSubscriptionChanges.createdAt,
    })
    .from(schema.billingSubscriptionChanges)
    .where(gte(schema.billingSubscriptionChanges.createdAt, since));

  let emitted = 0;
  for (const change of changes) {
    let planName: string | undefined;
    if (change.toPlanVersionId) {
      const plan = (
        await db
          .select({ name: schema.billingPlans.name })
          .from(schema.billingPlanVersions)
          .innerJoin(schema.billingPlans, eq(schema.billingPlans.id, schema.billingPlanVersions.planId))
          .where(eq(schema.billingPlanVersions.id, change.toPlanVersionId))
          .limit(1)
      )[0];
      planName = plan?.name;
    }
    const type = subscriptionNotificationType(change.toStatus);
    const result = await notifications.emit({
      id: `subscription-change:${change.id}`,
      type,
      organizationId: change.organizationId,
      userIds: await adminUserIds(db, change.organizationId),
      metadata: {
        subscriptionId: change.subscriptionId,
        planName,
        fromStatus: change.fromStatus,
        toStatus: change.toStatus,
        kind: change.kind,
        detail: type === "subscription_changed" ? "The workspace subscription configuration changed." : undefined,
      },
      link: "/settings/billing",
      occurredAt: change.effectiveAt ?? change.createdAt,
    });
    emitted += result.notificationsCreated;
  }
  return emitted;
}

async function emitUsageThresholds(db: Database, notifications: NotificationEmitter, since: Date): Promise<number> {
  const usageRows = await db
    .select({
      id: schema.billingPeriodUsage.id,
      organizationId: schema.billingPeriodUsage.organizationId,
      subscriptionId: schema.billingPeriodUsage.subscriptionId,
      entitlementKey: schema.billingPeriodUsage.entitlementKey,
      quantity: schema.billingPeriodUsage.quantity,
      periodStart: schema.billingPeriodUsage.periodStart,
      periodEnd: schema.billingPeriodUsage.periodEnd,
      updatedAt: schema.billingPeriodUsage.updatedAt,
    })
    .from(schema.billingPeriodUsage)
    .where(gte(schema.billingPeriodUsage.updatedAt, since));

  let emitted = 0;
  for (const usage of usageRows) {
    const subscription = (
      await db
        .select({ planVersionId: schema.billingSubscriptions.planVersionId })
        .from(schema.billingSubscriptions)
        .where(and(
          eq(schema.billingSubscriptions.id, usage.subscriptionId),
          eq(schema.billingSubscriptions.organizationId, usage.organizationId),
        ))
        .limit(1)
    )[0];
    if (!subscription) continue;
    const entitlement = (
      await db
        .select({ limit: schema.billingPlanEntitlements.limitValue })
        .from(schema.billingPlanEntitlements)
        .where(and(
          eq(schema.billingPlanEntitlements.planVersionId, subscription.planVersionId),
          eq(schema.billingPlanEntitlements.key, usage.entitlementKey),
          eq(schema.billingPlanEntitlements.enabled, true),
        ))
        .limit(1)
    )[0];
    const percent = usagePercent(usage.quantity, entitlement?.limit ?? null);
    if (percent === null || percent < 80) continue;
    const result = await notifications.emit({
      id: `usage-threshold:${usage.id}:80`,
      type: "usage_limit_approaching",
      organizationId: usage.organizationId,
      metadata: {
        entitlementKey: usage.entitlementKey,
        used: usage.quantity,
        limit: entitlement?.limit,
        percent,
        periodStart: usage.periodStart.toISOString(),
        periodEnd: usage.periodEnd.toISOString(),
      },
      link: "/settings/billing",
      occurredAt: usage.updatedAt,
    });
    emitted += result.notificationsCreated;
  }
  return emitted;
}

async function emitCampaignTerminalStates(db: Database, notifications: NotificationEmitter, since: Date): Promise<number> {
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
async function emitImportCompletionStates(db: Database, notifications: NotificationEmitter, since: Date): Promise<number> {
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

export async function reconcileNotificationSources(input: {
  db: Database;
  notifications: NotificationEmitter;
  since: Date;
}): Promise<{
  platform: number;
  workspace: number;
  payments: number;
  subscriptions: number;
  usage: number;
  campaigns: number;
  imports: number;
}> {
  const [platform, workspace, payments, subscriptions, usage, campaigns, imports] = await Promise.all([
    emitPlatformAuditEvents(input.db, input.notifications, input.since),
    emitWorkspaceAuditEvents(input.db, input.notifications, input.since),
    emitPaymentFailures(input.db, input.notifications, input.since),
    emitSubscriptionChanges(input.db, input.notifications, input.since),
    emitUsageThresholds(input.db, input.notifications, input.since),
    emitCampaignTerminalStates(input.db, input.notifications, input.since),
    emitImportCompletionStates(input.db, input.notifications, input.since),
  ]);
  return { platform, workspace, payments, subscriptions, usage, campaigns, imports };
}
