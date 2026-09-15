export const NOTIFICATION_TYPES = [
  "campaign_completed",
  "campaign_failed",
  "import_completed",
  "import_failed",
  "template_approved",
  "template_rejected",
  "whatsapp_disconnected",
  "whatsapp_connection_problem",
  "quality_rating_degraded",
  "usage_limit_approaching",
  "billing_payment_failed",
  "subscription_past_due",
  "security_event",
  "team_invitation",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export type NotificationLocale = "en" | "ar";
export type NotificationMetadata = Record<string, unknown>;

export type DomainEvent = {
  id: string;
  type: NotificationType;
  organizationId: string;
  userIds?: string[];
  metadata?: NotificationMetadata;
  link?: string | null;
  occurredAt?: Date;
};

export type NotificationDefinition = {
  type: NotificationType;
  category: "campaigns" | "imports" | "templates" | "whatsapp" | "usage" | "billing" | "security" | "team";
  label: { en: string; ar: string };
  mandatory: boolean;
};
