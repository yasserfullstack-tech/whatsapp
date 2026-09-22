import { and, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { schema } from "@wa/db";
import {
  adminUserIds,
  asRecord,
  asString,
  isQualityDegraded,
  templateNotificationType,
  type Database,
  type NotificationEmitter,
} from "./notification-source-utils";

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

export async function emitPlatformAuditEvents(db: Database, notifications: NotificationEmitter, since: Date): Promise<number> {
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

export async function emitWorkspaceAuditEvents(db: Database, notifications: NotificationEmitter, since: Date): Promise<number> {
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
