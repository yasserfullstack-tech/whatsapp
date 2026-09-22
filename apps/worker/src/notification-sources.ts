import {
  emitPlatformAuditEvents,
  emitWorkspaceAuditEvents,
} from "./notification-audit-sources";
import {
  emitPaymentFailures,
  emitSubscriptionChanges,
  emitUsageThresholds,
} from "./notification-billing-sources";
import {
  emitCampaignTerminalStates,
  emitImportCompletionStates,
} from "./notification-terminal-sources";
import type {
  Database,
  NotificationEmitter,
} from "./notification-source-utils";

export {
  isQualityDegraded,
  subscriptionNotificationType,
  templateNotificationType,
  usagePercent,
} from "./notification-source-utils";
export {
  emitCampaignTerminalNotification,
  emitImportTerminalNotification,
} from "./notification-terminal-sources";

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
