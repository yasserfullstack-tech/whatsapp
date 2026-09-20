import type { NotificationType } from "./types";

/**
 * Runtime wiring contract for the notification catalog.
 *
 * Every entry in {@link NOTIFICATION_TYPES} must name the durable product state
 * (or queue signal) that originates it and the runtime entry point that turns
 * that state into a `DomainEvent`. `event-sources.test.ts` fails when a catalog
 * type is missing here, when a declared emitter file or anchor disappears, or
 * when a source claims durable reconciliation that the worker's reconciliation
 * pass does not actually perform.
 *
 * Repository paths are relative to the monorepo root.
 */
export type NotificationEventSource = {
  /** Durable product state or queue signal that originates the event. */
  source: string;
  /** How the emitter resolves recipients for this event. */
  recipients: string;
  /** Emitter entry points that must exist in the runtime. */
  emitters: { file: string; anchor: string }[];
  /** Reconciler function in the durable source pass, when the event can be re-derived. */
  reconciler?: { file: string; anchor: string };
};

const NOTIFICATION_SOURCES = "apps/worker/src/notification-sources.ts";
const NOTIFICATION_RUNTIME = "apps/worker/src/notification-runtime.ts";
const CONNECTION_HEALTH = "apps/worker/src/connection-health.ts";
const INBOX = "apps/worker/src/inbox.ts";

export const NOTIFICATION_EVENT_SOURCES: Record<NotificationType, NotificationEventSource> = {
  campaign_completed: {
    source: "`campaigns.status` terminal state (BullMQ campaign-dispatch completion, replayed by the durable scan)",
    recipients: "Workspace members, filtered by preferences",
    emitters: [
      { file: NOTIFICATION_RUNTIME, anchor: "emitCampaignTerminalNotification" },
      { file: NOTIFICATION_SOURCES, anchor: "\"campaign_completed\"" },
    ],
    reconciler: { file: NOTIFICATION_SOURCES, anchor: "emitCampaignTerminalStates" },
  },
  campaign_failed: {
    source: "`campaigns.status` terminal state (BullMQ campaign-dispatch failure, replayed by the durable scan)",
    recipients: "Workspace members, filtered by preferences",
    emitters: [
      { file: NOTIFICATION_RUNTIME, anchor: "emitCampaignTerminalNotification" },
      { file: NOTIFICATION_SOURCES, anchor: "\"campaign_failed\"" },
    ],
    reconciler: { file: NOTIFICATION_SOURCES, anchor: "emitCampaignTerminalStates" },
  },
  import_completed: {
    source: "`contact_imports.status` = completed (BullMQ contact-import completion, replayed by the durable scan)",
    recipients: "Workspace members, filtered by preferences",
    emitters: [
      { file: NOTIFICATION_RUNTIME, anchor: "emitImportTerminalNotification" },
      { file: NOTIFICATION_SOURCES, anchor: "\"import_completed\"" },
    ],
    reconciler: { file: NOTIFICATION_SOURCES, anchor: "emitImportCompletionStates" },
  },
  import_failed: {
    source: "`contact_imports.status` = failed once the contact-import queue has exhausted its attempts",
    recipients: "Workspace members, filtered by preferences",
    // No reconciler: `processContactImport` writes `status = "failed"` before
    // rethrowing on every attempt, so a failed row is not terminal until the
    // queue gives up. Only the queue hook can tell the two apart.
    emitters: [{ file: NOTIFICATION_RUNTIME, anchor: "emitImportTerminalNotification" }],
  },
  template_approved: {
    source: "`platform_audit_events` rows for `meta.asset.template_status_changed` / `meta.asset.template_reconciled` with status approved",
    recipients: "Workspace members, filtered by preferences",
    emitters: [{ file: NOTIFICATION_SOURCES, anchor: "\"template_approved\"" }],
    reconciler: { file: NOTIFICATION_SOURCES, anchor: "emitPlatformAuditEvents" },
  },
  template_rejected: {
    source: "`platform_audit_events` rows for `meta.asset.template_status_changed` / `meta.asset.template_reconciled` with status rejected",
    recipients: "Workspace members, filtered by preferences",
    emitters: [{ file: NOTIFICATION_SOURCES, anchor: "\"template_rejected\"" }],
    reconciler: { file: NOTIFICATION_SOURCES, anchor: "emitPlatformAuditEvents" },
  },
  whatsapp_disconnected: {
    source: "`workspace_audit_logs` rows for `whatsapp.disconnected`",
    recipients: "Owners/admins; mandatory",
    emitters: [{ file: NOTIFICATION_SOURCES, anchor: "\"whatsapp_disconnected\"" }],
    reconciler: { file: NOTIFICATION_SOURCES, anchor: "emitWorkspaceAuditEvents" },
  },
  whatsapp_connection_problem: {
    source: "Connection-health transition to reauthorization required, plus restricted-WABA `platform_audit_events`",
    recipients: "Owners/admins; mandatory",
    emitters: [
      { file: CONNECTION_HEALTH, anchor: "\"whatsapp_connection_problem\"" },
      { file: NOTIFICATION_SOURCES, anchor: "\"whatsapp_connection_problem\"" },
    ],
    reconciler: { file: NOTIFICATION_SOURCES, anchor: "emitPlatformAuditEvents" },
  },
  quality_rating_degraded: {
    source: "`platform_audit_events` rows for `meta.asset.phone_quality_reconciled` with a worse known rating",
    recipients: "Owners/admins, filtered by preferences",
    emitters: [{ file: NOTIFICATION_SOURCES, anchor: "\"quality_rating_degraded\"" }],
    reconciler: { file: NOTIFICATION_SOURCES, anchor: "emitPlatformAuditEvents" },
  },
  usage_limit_approaching: {
    source: "`billing_period_usage` rows at or above 80% of a finite plan entitlement",
    recipients: "Workspace members, filtered by preferences",
    emitters: [{ file: NOTIFICATION_SOURCES, anchor: "\"usage_limit_approaching\"" }],
    reconciler: { file: NOTIFICATION_SOURCES, anchor: "emitUsageThresholds" },
  },
  billing_payment_failed: {
    source: "Processed `billing_provider_events` rows for `invoice.payment_failed`",
    recipients: "Owners/admins; mandatory",
    emitters: [{ file: NOTIFICATION_SOURCES, anchor: "\"billing_payment_failed\"" }],
    reconciler: { file: NOTIFICATION_SOURCES, anchor: "emitPaymentFailures" },
  },
  subscription_past_due: {
    source: "`billing_subscription_changes` rows whose resulting status is `past_due` or `grace_period`",
    recipients: "Owners/admins; mandatory",
    emitters: [{ file: NOTIFICATION_SOURCES, anchor: "\"subscription_past_due\"" }],
    reconciler: { file: NOTIFICATION_SOURCES, anchor: "emitSubscriptionChanges" },
  },
  subscription_changed: {
    source: "Any other `billing_subscription_changes` row",
    recipients: "Owners/admins, filtered by preferences",
    emitters: [{ file: NOTIFICATION_SOURCES, anchor: "\"subscription_changed\"" }],
    reconciler: { file: NOTIFICATION_SOURCES, anchor: "emitSubscriptionChanges" },
  },
  security_event: {
    source: "`workspace_audit_logs` rows for security/account and privileged membership or ownership actions",
    recipients: "Affected user or owners/admins; mandatory",
    emitters: [{ file: NOTIFICATION_SOURCES, anchor: "\"security_event\"" }],
    reconciler: { file: NOTIFICATION_SOURCES, anchor: "emitWorkspaceAuditEvents" },
  },
  inbound_message: {
    source: "Successfully persisted inbound `inbox_messages` row",
    recipients: "Workspace members who explicitly opted in",
    emitters: [{ file: INBOX, anchor: "\"inbound_message\"" }],
  },
};

/** Repository path of the module that runs the periodic durable source pass. */
export const NOTIFICATION_RECONCILE_MODULE = NOTIFICATION_SOURCES;
