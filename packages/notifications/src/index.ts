import { and, count, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { createDatabase, schema } from "@wa/db";

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

type Database = ReturnType<typeof createDatabase>["db"];

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

function optionalValue(metadata: NotificationMetadata, key: string): string | null {
  const candidate = metadata[key];
  if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  if (typeof candidate === "number" && Number.isFinite(candidate)) return String(candidate);
  return null;
}

function notificationCopy(type: NotificationType, locale: NotificationLocale, metadata: NotificationMetadata) {
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

function defaultLink(type: NotificationType, metadata: NotificationMetadata): string | null {
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

export class NotificationService {
  constructor(private readonly input: {
    db: Database;
    enqueueEmailDelivery?: (deliveryId: string) => Promise<void>;
    onEnqueueError?: (error: unknown, deliveryId: string) => void;
  }) {}

  async emit(event: DomainEvent): Promise<{ notificationsCreated: number; emailDeliveriesQueued: number }> {
    const metadata = event.metadata ?? {};
    if (event.userIds && event.userIds.length === 0) return { notificationsCreated: 0, emailDeliveriesQueued: 0 };

    const recipientPredicate = event.userIds
      ? and(eq(schema.organizationMembers.organizationId, event.organizationId), inArray(schema.users.id, event.userIds))
      : eq(schema.organizationMembers.organizationId, event.organizationId);

    const recipients = await this.input.db
      .select({ userId: schema.users.id })
      .from(schema.organizationMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.organizationMembers.userId))
      .where(recipientPredicate);
    if (!recipients.length) return { notificationsCreated: 0, emailDeliveriesQueued: 0 };

    const userIds = recipients.map((recipient) => recipient.userId);
    const [localeRow, preferences] = await Promise.all([
      this.input.db
        .select({ preferredLanguage: schema.workspacePreferences.preferredLanguage })
        .from(schema.workspacePreferences)
        .where(eq(schema.workspacePreferences.organizationId, event.organizationId))
        .limit(1)
        .then((rows) => rows[0]),
      this.input.db
        .select({
          userId: schema.notificationPreferences.userId,
          inAppEnabled: schema.notificationPreferences.inAppEnabled,
          emailEnabled: schema.notificationPreferences.emailEnabled,
        })
        .from(schema.notificationPreferences)
        .where(and(
          eq(schema.notificationPreferences.organizationId, event.organizationId),
          eq(schema.notificationPreferences.type, event.type),
          inArray(schema.notificationPreferences.userId, userIds),
        )),
    ]);

    const locale: NotificationLocale = localeRow?.preferredLanguage === "ar" ? "ar" : "en";
    const copy = notificationCopy(event.type, locale, metadata);
    const preferenceByUser = new Map(preferences.map((preference) => [preference.userId, preference]));
    const emailDeliveryIds: string[] = [];
    let notificationsCreated = 0;

    await this.input.db.transaction(async (tx) => {
      for (const recipient of recipients) {
        const channels = resolveNotificationChannels(event.type, preferenceByUser.get(recipient.userId));
        const inserted = await tx
          .insert(schema.notifications)
          .values({
            organizationId: event.organizationId,
            userId: recipient.userId,
            type: event.type,
            title: copy.title,
            message: copy.message,
            metadata: { ...metadata, locale, occurredAt: (event.occurredAt ?? new Date()).toISOString() },
            link: event.link === undefined ? defaultLink(event.type, metadata) : event.link,
            dedupeKey: event.id,
          })
          .onConflictDoNothing({
            target: [schema.notifications.organizationId, schema.notifications.userId, schema.notifications.dedupeKey],
          })
          .returning({ id: schema.notifications.id });
        const notification = inserted[0];
        if (!notification) continue;
        notificationsCreated += 1;

        const deliveryRows = await tx
          .insert(schema.notificationDeliveries)
          .values([
            {
              notificationId: notification.id,
              organizationId: event.organizationId,
              userId: recipient.userId,
              channel: "in_app",
              status: channels.inApp ? "sent" : "suppressed",
              sentAt: channels.inApp ? new Date() : null,
            },
            {
              notificationId: notification.id,
              organizationId: event.organizationId,
              userId: recipient.userId,
              channel: "email",
              status: channels.email ? "pending" : "suppressed",
            },
          ])
          .returning({ id: schema.notificationDeliveries.id, channel: schema.notificationDeliveries.channel, status: schema.notificationDeliveries.status });
        for (const delivery of deliveryRows) {
          if (delivery.channel === "email" && delivery.status === "pending") emailDeliveryIds.push(delivery.id);
        }
      }
    });

    let emailDeliveriesQueued = 0;
    if (this.input.enqueueEmailDelivery) {
      for (const deliveryId of emailDeliveryIds) {
        try {
          await this.input.enqueueEmailDelivery(deliveryId);
          emailDeliveriesQueued += 1;
        } catch (error) {
          this.input.onEnqueueError?.(error, deliveryId);
        }
      }
    }

    return { notificationsCreated, emailDeliveriesQueued };
  }
}

export interface EmailProvider {
  send(input: {
    to: string;
    subject: string;
    html: string;
    text: string;
    locale: NotificationLocale;
    direction: "ltr" | "rtl";
    idempotencyKey: string;
  }): Promise<{ messageId?: string }>;
}

export class ConsoleEmailProvider implements EmailProvider {
  async send(input: Parameters<EmailProvider["send"]>[0]): Promise<{ messageId: string }> {
    const messageId = `console-${input.idempotencyKey}`;
    console.info("notification_email_captured", { to: input.to, subject: input.subject, locale: input.locale, messageId });
    return { messageId };
  }
}

function escapeHtml(input: string): string {
  return input.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] ?? character);
}

export function renderNotificationEmail(input: {
  title: string;
  message: string;
  link?: string | null;
  locale: NotificationLocale;
  baseUrl?: string;
}) {
  const direction = input.locale === "ar" ? "rtl" : "ltr";
  const actionLabel = input.locale === "ar" ? "عرض التفاصيل" : "View details";
  const footer = input.locale === "ar" ? "تم إرسال هذا الإشعار من مساحة عمل واتساب الخاصة بك." : "This notification was sent from your WhatsApp workspace.";
  const fallbackBaseUrl = process.env.NODE_ENV === "production" ? null : "http://127.0.0.1:3000";
  const baseUrl = input.baseUrl ?? fallbackBaseUrl;
  if (input.link && !baseUrl) throw new Error("A notification base URL is required when rendering a production link");
  const absoluteLink = input.link && baseUrl ? new URL(input.link, baseUrl).toString() : null;
  const title = escapeHtml(input.title);
  const message = escapeHtml(input.message);
  const html = `<!doctype html><html lang="${input.locale}" dir="${direction}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f6f7f8;font-family:Arial,sans-serif;direction:${direction};text-align:${input.locale === "ar" ? "right" : "left"}"><main style="max-width:600px;margin:0 auto;padding:32px 20px"><section style="background:#fff;border:1px solid #e7e9ec;border-radius:14px;padding:28px"><h1 style="font-size:22px;margin:0 0 12px">${title}</h1><p style="font-size:16px;line-height:1.65;margin:0 0 20px">${message}</p>${absoluteLink ? `<p style="margin:0"><a href="${escapeHtml(absoluteLink)}" style="display:inline-block;padding:11px 16px;border-radius:9px;background:#111;color:#fff;text-decoration:none">${actionLabel}</a></p>` : ""}</section><p style="font-size:12px;color:#68707a;line-height:1.5;margin:16px 4px">${footer}</p></main></body></html>`;
  const text = `${input.title}\n\n${input.message}${absoluteLink ? `\n\n${actionLabel}: ${absoluteLink}` : ""}\n\n${footer}`;
  return { subject: input.title, html, text, direction } as const;
}

export async function deliverNotificationEmail(input: {
  db: Database;
  deliveryId: string;
  provider: EmailProvider;
  finalAttempt: boolean;
  baseUrl?: string;
}) {
  const row = (
    await input.db
      .select({
        deliveryId: schema.notificationDeliveries.id,
        status: schema.notificationDeliveries.status,
        channel: schema.notificationDeliveries.channel,
        notificationId: schema.notifications.id,
        title: schema.notifications.title,
        message: schema.notifications.message,
        link: schema.notifications.link,
        email: schema.users.email,
        preferredLanguage: schema.workspacePreferences.preferredLanguage,
      })
      .from(schema.notificationDeliveries)
      .innerJoin(schema.notifications, eq(schema.notifications.id, schema.notificationDeliveries.notificationId))
      .innerJoin(schema.users, eq(schema.users.id, schema.notificationDeliveries.userId))
      .leftJoin(schema.workspacePreferences, eq(schema.workspacePreferences.organizationId, schema.notificationDeliveries.organizationId))
      .where(eq(schema.notificationDeliveries.id, input.deliveryId))
      .limit(1)
  )[0];

  if (!row) throw new Error(`Notification delivery ${input.deliveryId} was not found`);
  if (row.channel !== "email") return { skipped: true, reason: "not-email" } as const;
  if (["sent", "suppressed", "dead_letter"].includes(row.status)) return { skipped: true, reason: row.status } as const;

  const attempted = (
    await input.db
      .update(schema.notificationDeliveries)
      .set({ attemptCount: schema.notificationDeliveries.attemptCount, nextRetryAt: null, updatedAt: new Date() })
      .where(eq(schema.notificationDeliveries.id, row.deliveryId))
      .returning({ attemptCount: schema.notificationDeliveries.attemptCount })
  )[0];
  const attemptCount = (attempted?.attemptCount ?? 0) + 1;
  await input.db
    .update(schema.notificationDeliveries)
    .set({ attemptCount, updatedAt: new Date() })
    .where(eq(schema.notificationDeliveries.id, row.deliveryId));

  const locale: NotificationLocale = row.preferredLanguage === "ar" ? "ar" : "en";
  const rendered = renderNotificationEmail({ title: row.title, message: row.message, link: row.link, locale, ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}) });

  try {
    const result = await input.provider.send({
      to: row.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      locale,
      direction: rendered.direction,
      idempotencyKey: `notification:${row.notificationId}:email`,
    });
    const sentAt = new Date();
    await input.db
      .update(schema.notificationDeliveries)
      .set({ status: "sent", sentAt, failedAt: null, nextRetryAt: null, error: null, providerMessageId: result.messageId ?? null, updatedAt: sentAt })
      .where(eq(schema.notificationDeliveries.id, row.deliveryId));
    return { sent: true, messageId: result.messageId } as const;
  } catch (error) {
    const failedAt = new Date();
    const nextRetryAt = input.finalAttempt ? null : new Date(Date.now() + Math.min(60 * 60_000, 30_000 * 2 ** Math.min(attemptCount, 6)));
    await input.db
      .update(schema.notificationDeliveries)
      .set({
        status: input.finalAttempt ? "dead_letter" : "failed",
        failedAt,
        nextRetryAt,
        error: (error instanceof Error ? error.message : "Unknown email delivery error").slice(0, 2_000),
        updatedAt: failedAt,
      })
      .where(eq(schema.notificationDeliveries.id, row.deliveryId));
    throw error;
  }
}

export async function getPendingEmailDeliveryIds(db: Database, limit = 500): Promise<string[]> {
  const rows = await db
    .select({ id: schema.notificationDeliveries.id })
    .from(schema.notificationDeliveries)
    .where(and(
      eq(schema.notificationDeliveries.channel, "email"),
      inArray(schema.notificationDeliveries.status, ["pending", "failed"]),
      or(isNull(schema.notificationDeliveries.nextRetryAt), lte(schema.notificationDeliveries.nextRetryAt, new Date())),
    ))
    .limit(Math.max(1, Math.min(limit, 2_000)));
  return rows.map((row) => row.id);
}

export async function getUnreadNotificationCount(db: Database, input: { organizationId: string; userId: string }): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(schema.notifications)
    .innerJoin(schema.notificationDeliveries, and(
      eq(schema.notificationDeliveries.notificationId, schema.notifications.id),
      eq(schema.notificationDeliveries.channel, "in_app"),
      eq(schema.notificationDeliveries.status, "sent"),
    ))
    .where(and(
      eq(schema.notifications.organizationId, input.organizationId),
      eq(schema.notifications.userId, input.userId),
      isNull(schema.notifications.readAt),
    ));
  return row?.total ?? 0;
}

export async function markNotificationRead(db: Database, input: { organizationId: string; userId: string; notificationId: string }) {
  return db
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(and(
      eq(schema.notifications.id, input.notificationId),
      eq(schema.notifications.organizationId, input.organizationId),
      eq(schema.notifications.userId, input.userId),
    ))
    .returning({ id: schema.notifications.id });
}

export async function markAllNotificationsRead(db: Database, input: { organizationId: string; userId: string }) {
  return db
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(and(
      eq(schema.notifications.organizationId, input.organizationId),
      eq(schema.notifications.userId, input.userId),
      isNull(schema.notifications.readAt),
    ))
    .returning({ id: schema.notifications.id });
}
