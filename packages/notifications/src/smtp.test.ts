import { describe, expect, test } from "bun:test";
import {
  buildSmtpMessage,
  envelopeAddress,
  loadSmtpEmailConfig,
} from "./smtp";

describe("SMTP email configuration", () => {
  test("uses Gmail-compatible TLS defaults when SMTP is configured", () => {
    const config = loadSmtpEmailConfig({
      SMTP_HOST: "smtp.gmail.com",
      SMTP_USER: "sender@gmail.com",
      SMTP_PASSWORD: "app-password",
      EMAIL_FROM: "WhatsApp Campaigns <sender@gmail.com>",
    }, { required: true });

    expect(config).toEqual({
      host: "smtp.gmail.com",
      port: 465,
      security: "tls",
      username: "sender@gmail.com",
      password: "app-password",
      from: "WhatsApp Campaigns <sender@gmail.com>",
    });
  });

  test("uses port 587 by default for STARTTLS", () => {
    const config = loadSmtpEmailConfig({
      SMTP_HOST: "smtp.example.com",
      SMTP_SECURITY: "starttls",
      SMTP_USER: "sender@example.com",
      SMTP_PASSWORD: "secret",
      EMAIL_FROM: "sender@example.com",
    }, { required: true });
    expect(config?.port).toBe(587);
    expect(config?.security).toBe("starttls");
  });

  test("returns null when optional SMTP is entirely unconfigured", () => {
    expect(loadSmtpEmailConfig({}, { required: false })).toBeNull();
  });

  test("rejects partial production SMTP configuration", () => {
    expect(() => loadSmtpEmailConfig({
      SMTP_HOST: "smtp.gmail.com",
      EMAIL_FROM: "sender@gmail.com",
    }, { required: true })).toThrow("SMTP_USER is required");
  });
});

describe("SMTP message construction", () => {
  test("extracts the envelope address from a display mailbox", () => {
    expect(envelopeAddress("WhatsApp Campaigns <sender@gmail.com>")).toBe("sender@gmail.com");
  });

  test("builds UTF-8 multipart mail with a stable idempotency message id", () => {
    const first = buildSmtpMessage({
      from: "WhatsApp Campaigns <sender@gmail.com>",
      replyTo: "support@gmail.com",
      to: "recipient@example.com",
      subject: "تنبيه",
      text: "Hello",
      html: "<strong>Hello</strong>",
      idempotencyKey: "notification:abc:email",
      date: new Date("2026-09-21T08:00:00.000Z"),
    });
    const second = buildSmtpMessage({
      from: "WhatsApp Campaigns <sender@gmail.com>",
      replyTo: "support@gmail.com",
      to: "recipient@example.com",
      subject: "تنبيه",
      text: "Hello",
      html: "<strong>Hello</strong>",
      idempotencyKey: "notification:abc:email",
      date: new Date("2026-09-21T08:00:00.000Z"),
    });

    expect(first.messageId).toBe(second.messageId);
    expect(first.message).toContain("Content-Type: multipart/alternative");
    expect(first.message).toContain("Reply-To: support@gmail.com");
    expect(first.message).toContain("Subject: =?UTF-8?B?");
    expect(first.message).not.toContain("تنبيه");
  });

  test("rejects header injection", () => {
    expect(() => buildSmtpMessage({
      from: "sender@gmail.com",
      to: "recipient@example.com\r\nBcc: attacker@example.com",
      subject: "hello",
      text: "body",
    })).toThrow();
  });
});
