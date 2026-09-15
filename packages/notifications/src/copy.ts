import type { NotificationLocale, NotificationMetadata, NotificationType } from "./types";

function optionalValue(metadata: NotificationMetadata, key: string): string | null {
  const candidate = metadata[key];
  if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  if (typeof candidate === "number" && Number.isFinite(candidate)) return String(candidate);
  return null;
}

export function notificationCopy(type: NotificationType, locale: NotificationLocale, metadata: NotificationMetadata) {
  const campaign = optionalValue(metadata, "campaignName");
  const file = optionalValue(metadata, "fileName");
  const template = optionalValue(metadata, "templateName");
  const number = optionalValue(metadata, "phoneNumber");
  const percent = optionalValue(metadata, "percent");
  const detail = optionalValue(metadata, "detail");
  const role = optionalValue(metadata, "role");
  const workspace = optionalValue(metadata, "workspaceName");

  if (locale === "ar") {
    switch (type) {
      case "campaign_completed": return { title: "اكتملت الحملة", message: campaign ? `اكتملت الحملة «${campaign}».` : "اكتملت الحملة." };
      case "campaign_failed": return { title: "فشلت الحملة", message: campaign ? `فشلت الحملة «${campaign}». راجع التفاصيل وحاول مجدداً.` : "فشلت الحملة. راجع التفاصيل وحاول مجدداً." };
      case "import_completed": return { title: "اكتمل الاستيراد", message: file ? `اكتمل استيراد «${file}».` : "اكتمل الاستيراد." };
      case "import_failed": return { title: "فشل الاستيراد", message: file ? `فشل استيراد «${file}». راجع أخطاء الملف.` : "فشل الاستيراد. راجع أخطاء الملف." };
      case "template_approved": return { title: "تمت الموافقة على القالب", message: template ? `وافقت Meta على القالب «${template}».` : "وافقت Meta على القالب." };
      case "template_rejected": return { title: "تم رفض القالب", message: template ? `رفضت Meta القالب «${template}». راجع سبب الرفض.` : "رفضت Meta القالب. راجع سبب الرفض." };
      case "whatsapp_disconnected": return { title: "انقطع اتصال واتساب", message: number ? `الرقم ${number} غير متصل. أعد الاتصال لاستئناف الإرسال.` : "أحد أرقام واتساب غير متصل. راجع الاتصال لاستئناف الإرسال." };
      case "whatsapp_connection_problem": return { title: "اتصال واتساب يحتاج إلى انتباه", message: number ? `توجد مشكلة في اتصال ${number}.` : "توجد مشكلة في اتصال أحد أرقام واتساب." };
      case "quality_rating_degraded": return { title: "انخفض تقييم الجودة", message: number ? `انخفض تقييم الجودة للرقم ${number}. راجع جودة الرسائل والموافقة.` : "انخفض تقييم الجودة لأحد أرقام واتساب. راجع جودة الرسائل والموافقة." };
      case "usage_limit_approaching": return { title: "تقترب من حد الاستخدام", message: percent ? `وصل الاستخدام إلى ${percent}% من الحد الحالي.` : "يقترب الاستخدام من الحد الحالي." };
      case "billing_payment_failed": return { title: "فشل الدفع", message: "تعذر إتمام دفعة الفوترة. راجع طريقة الدفع وحالة الفاتورة." };
      case "subscription_past_due": return { title: "الاشتراك متأخر الاستحقاق", message: "الاشتراك متأخر الاستحقاق ويحتاج إلى معالجة الفوترة." };
      case "security_event": return { title: "حدث أمني مهم", message: detail ?? "تم رصد حدث أمني مهم في حسابك." };
      case "team_invitation": {
        if (workspace && role) return { title: "دعوة إلى الفريق", message: `تمت دعوتك للانضمام إلى ${workspace} بدور ${role}.` };
        if (workspace) return { title: "دعوة إلى الفريق", message: `تمت دعوتك للانضمام إلى ${workspace}.` };
        return { title: "دعوة إلى الفريق", message: "تمت دعوتك للانضمام إلى مساحة عمل." };
      }
    }
  }

  switch (type) {
    case "campaign_completed": return { title: "Campaign completed", message: campaign ? `Campaign “${campaign}” completed.` : "Campaign completed." };
    case "campaign_failed": return { title: "Campaign failed", message: campaign ? `Campaign “${campaign}” failed. Review the details and retry when ready.` : "Campaign failed. Review the details and retry when ready." };
    case "import_completed": return { title: "Import completed", message: file ? `Import “${file}” completed.` : "Import completed." };
    case "import_failed": return { title: "Import failed", message: file ? `Import “${file}” failed. Review the file errors.` : "Import failed. Review the file errors." };
    case "template_approved": return { title: "Template approved", message: template ? `Meta approved template “${template}”.` : "Meta approved the template." };
    case "template_rejected": return { title: "Template rejected", message: template ? `Meta rejected template “${template}”. Review the rejection reason.` : "Meta rejected the template. Review the rejection reason." };
    case "whatsapp_disconnected": return { title: "WhatsApp disconnected", message: number ? `${number} is disconnected. Reconnect it to resume sending.` : "A WhatsApp number is disconnected. Review the connection to resume sending." };
    case "whatsapp_connection_problem": return { title: "WhatsApp connection needs attention", message: number ? `There is a connection problem with ${number}.` : "There is a connection problem with a WhatsApp number." };
    case "quality_rating_degraded": return { title: "Quality rating degraded", message: number ? `${number} has a lower quality rating. Review message quality and consent.` : "A WhatsApp number has a lower quality rating. Review message quality and consent." };
    case "usage_limit_approaching": return { title: "Usage limit approaching", message: percent ? `Usage has reached ${percent}% of the current limit.` : "Usage is approaching the current limit." };
    case "billing_payment_failed": return { title: "Billing payment failed", message: "A billing payment could not be completed. Review the payment method and invoice status." };
    case "subscription_past_due": return { title: "Subscription past due", message: "The subscription is past due and needs billing attention." };
    case "security_event": return { title: "Important security event", message: detail ?? "An important security event was detected for your account." };
    case "team_invitation": {
      if (workspace && role) return { title: "Team invitation", message: `You were invited to join ${workspace} as ${role}.` };
      if (workspace) return { title: "Team invitation", message: `You were invited to join ${workspace}.` };
      return { title: "Team invitation", message: "You were invited to join a workspace." };
    }
  }
}

export function defaultNotificationLink(type: NotificationType, metadata: NotificationMetadata): string | null {
  const id = optionalValue(metadata, "campaignId");
  switch (type) {
    case "campaign_completed":
    case "campaign_failed":
      return id ? `/campaigns/${id}` : "/campaigns";
    case "import_completed":
    case "import_failed": return "/contacts";
    case "template_approved":
    case "template_rejected": return "/templates";
    case "whatsapp_disconnected":
    case "whatsapp_connection_problem":
    case "quality_rating_degraded": return "/settings/whatsapp";
    case "usage_limit_approaching": return "/settings/billing";
    case "billing_payment_failed":
    case "subscription_past_due": return "/settings/billing";
    case "security_event": return "/settings/security";
    case "team_invitation": return "/settings/team";
  }
}
