import { appendFile } from "node:fs/promises";
import type { AuthEmailMessage } from "@wa/auth";
import { loadSmtpEmailConfig, sendSmtpEmail } from "@wa/notifications";

export async function sendAuthEmail(message: AuthEmailMessage): Promise<void> {
  const captureFile = process.env.CI === "true" ? process.env.AUTH_EMAIL_CAPTURE_FILE : undefined;
  if (captureFile) {
    await appendFile(captureFile, `${JSON.stringify({ ...message, capturedAt: new Date().toISOString() })}\n`, "utf8");
    return;
  }

  const smtp = loadSmtpEmailConfig(process.env, {
    required: process.env.NODE_ENV === "production",
  });

  if (!smtp) {
    console.info(`[auth-email:development]\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}`);
    return;
  }

  await sendSmtpEmail(smtp, {
    to: message.to,
    subject: message.subject,
    text: message.text,
    idempotencyKey: `auth:${message.to}:${message.subject}`,
  });
}
