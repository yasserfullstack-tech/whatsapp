import { eq } from "drizzle-orm";
import { schema } from "@wa/db";
import type { NotificationDatabase } from "./database";
import type { NotificationLocale } from "./types";

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
  db: NotificationDatabase;
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
