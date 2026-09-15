import type { NotificationDefinition, NotificationType } from "./types";

export const NOTIFICATION_DEFINITIONS: NotificationDefinition[] = [
  { type: "campaign_completed", category: "campaigns", label: { en: "Campaign completed", ar: "اكتمال الحملة" }, mandatory: false },
  { type: "campaign_failed", category: "campaigns", label: { en: "Campaign failed", ar: "فشل الحملة" }, mandatory: false },
  { type: "import_completed", category: "imports", label: { en: "Import completed", ar: "اكتمال الاستيراد" }, mandatory: false },
  { type: "import_failed", category: "imports", label: { en: "Import failed", ar: "فشل الاستيراد" }, mandatory: false },
  { type: "template_approved", category: "templates", label: { en: "Template approved", ar: "الموافقة على القالب" }, mandatory: false },
  { type: "template_rejected", category: "templates", label: { en: "Template rejected", ar: "رفض القالب" }, mandatory: false },
  { type: "whatsapp_disconnected", category: "whatsapp", label: { en: "WhatsApp disconnected", ar: "انقطاع اتصال واتساب" }, mandatory: true },
  { type: "whatsapp_connection_problem", category: "whatsapp", label: { en: "WhatsApp connection problem", ar: "مشكلة في اتصال واتساب" }, mandatory: true },
  { type: "quality_rating_degraded", category: "whatsapp", label: { en: "Quality rating degraded", ar: "انخفاض تقييم الجودة" }, mandatory: false },
  { type: "usage_limit_approaching", category: "usage", label: { en: "Usage limit approaching", ar: "الاقتراب من حد الاستخدام" }, mandatory: false },
  { type: "billing_payment_failed", category: "billing", label: { en: "Payment failed", ar: "فشل الدفع" }, mandatory: true },
  { type: "subscription_past_due", category: "billing", label: { en: "Subscription past due", ar: "تأخر استحقاق الاشتراك" }, mandatory: true },
  { type: "security_event", category: "security", label: { en: "Security event", ar: "حدث أمني" }, mandatory: true },
  { type: "team_invitation", category: "team", label: { en: "Team invitation", ar: "دعوة إلى الفريق" }, mandatory: true },
];

const definitionByType = new Map(NOTIFICATION_DEFINITIONS.map((definition) => [definition.type, definition]));

export function isNotificationMandatory(type: NotificationType): boolean {
  return definitionByType.get(type)?.mandatory ?? false;
}

export function resolveNotificationChannels(
  type: NotificationType,
  preference?: { inAppEnabled: boolean; emailEnabled: boolean } | null,
): { inApp: boolean; email: boolean } {
  if (isNotificationMandatory(type)) return { inApp: true, email: true };
  return {
    inApp: preference?.inAppEnabled ?? true,
    email: preference?.emailEnabled ?? true,
  };
}
