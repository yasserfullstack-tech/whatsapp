import type { AuthEmailMessage } from "@wa/auth";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export async function sendAuthEmail(message: AuthEmailMessage): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.AUTH_EMAIL_FROM;

  if (!apiKey || !from) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("RESEND_API_KEY and AUTH_EMAIL_FROM are required in production");
    }

    console.info(`[auth-email:development]\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}`);
    return;
  }

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      ...(process.env.AUTH_EMAIL_REPLY_TO ? { reply_to: process.env.AUTH_EMAIL_REPLY_TO } : {}),
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Auth email provider returned ${response.status}${detail ? `: ${detail}` : ""}`);
  }
}
