import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { Socket } from "node:net";
import { connect as connectTls, type TLSSocket } from "node:tls";
import type { EmailProvider } from "./email";

export type SmtpSecurity = "tls" | "starttls";

export type SmtpEmailConfig = {
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string;
  password: string;
  from: string;
  replyTo?: string;
};

export type SmtpMailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  idempotencyKey?: string;
};

type SmtpSocket = Socket | TLSSocket;

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required for SMTP email delivery`);
  return normalized;
}

export function loadSmtpEmailConfig(
  source: Record<string, string | undefined> = process.env,
  options: { required?: boolean } = {},
): SmtpEmailConfig | null {
  const configured = [
    source.SMTP_HOST,
    source.SMTP_USER,
    source.SMTP_PASSWORD,
    source.EMAIL_FROM,
  ].some((value) => Boolean(value?.trim()));

  if (!configured && !options.required) return null;

  const securityValue = (source.SMTP_SECURITY?.trim().toLowerCase() || "tls");
  if (securityValue !== "tls" && securityValue !== "starttls") {
    throw new Error("SMTP_SECURITY must be either tls or starttls");
  }

  const portValue = source.SMTP_PORT?.trim() || (securityValue === "starttls" ? "587" : "465");
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("SMTP_PORT must be an integer between 1 and 65535");
  }

  const config: SmtpEmailConfig = {
    host: required(source.SMTP_HOST, "SMTP_HOST"),
    port,
    security: securityValue,
    username: required(source.SMTP_USER, "SMTP_USER"),
    password: required(source.SMTP_PASSWORD, "SMTP_PASSWORD"),
    from: required(source.EMAIL_FROM, "EMAIL_FROM"),
  };
  const replyTo = source.EMAIL_REPLY_TO?.trim();
  return replyTo ? { ...config, replyTo } : config;
}

function assertHeaderSafe(value: string, name: string): string {
  if (value.includes(String.fromCharCode(13)) || value.includes(String.fromCharCode(10))) {
    throw new Error(`${name} must not contain CR/LF characters`);
  }
  return value;
}

export function envelopeAddress(value: string): string {
  const safe = assertHeaderSafe(value.trim(), "Email address");
  const match = safe.match(/<([^<>]+)>\s*$/);
  const address = (match?.[1] ?? safe).trim();
  if (!/^[^\s@<>]+@[^\s@<>]+$/.test(address)) {
    throw new Error("Invalid email address");
  }
  return address;
}

function encodedHeader(value: string): string {
  assertHeaderSafe(value, "Header");
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function wrapBase64(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .match(/.{1,76}/g)
    ?.join("\r\n") ?? "";
}

function normalizeCrlf(value: string): string {
  return value.replace(/\r?\n/g, "\r\n");
}

function dotStuff(value: string): string {
  return normalizeCrlf(value).replace(/(^|\r\n)\./g, "$1..");
}

export function buildSmtpMessage(input: {
  from: string;
  replyTo?: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  idempotencyKey?: string;
  date?: Date;
}): { message: string; messageId: string } {
  const fromAddress = envelopeAddress(input.from);
  envelopeAddress(input.to);
  if (input.replyTo) envelopeAddress(input.replyTo);

  const domain = fromAddress.split("@")[1] ?? "localhost";
  const identity = input.idempotencyKey
    ? createHash("sha256").update(input.idempotencyKey).digest("hex").slice(0, 40)
    : randomUUID();
  const messageId = `<${identity}@${domain}>`;
  const headers = [
    `From: ${assertHeaderSafe(input.from, "From")}`,
    `To: ${assertHeaderSafe(input.to, "To")}`,
    `Subject: ${encodedHeader(input.subject)}`,
    `Date: ${(input.date ?? new Date()).toUTCString()}`,
    `Message-ID: ${messageId}`,
    "MIME-Version: 1.0",
  ];
  if (input.replyTo) headers.push(`Reply-To: ${assertHeaderSafe(input.replyTo, "Reply-To")}`);

  if (!input.html) {
    headers.push('Content-Type: text/plain; charset="UTF-8"');
    headers.push("Content-Transfer-Encoding: base64");
    return {
      message: [...headers, "", wrapBase64(input.text)].join("\r\n"),
      messageId,
    };
  }

  const boundary = `wa-${randomUUID()}`;
  headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
  const body = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(input.text),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(input.html),
    `--${boundary}--`,
  ].join("\r\n");

  return { message: [...headers, "", body].join("\r\n"), messageId };
}

class SmtpLineReader {
  private buffer = "";
  private readonly lines: string[] = [];
  private readonly waiters: Array<{
    resolve: (line: string) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];

  private readonly onData = (chunk: Buffer | string) => {
    this.buffer += chunk.toString();
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const raw = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      const waiter = this.waiters.shift();
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.resolve(line);
      } else {
        this.lines.push(line);
      }
      newline = this.buffer.indexOf("\n");
    }
  };

  private readonly onError = (error: Error) => this.rejectAll(error);
  private readonly onClose = () => this.rejectAll(new Error("SMTP connection closed unexpectedly"));

  constructor(private readonly socket: SmtpSocket) {
    socket.on("data", this.onData);
    socket.on("error", this.onError);
    socket.on("close", this.onClose);
  }

  async readLine(timeoutMs = 15_000): Promise<string> {
    const line = this.lines.shift();
    if (line !== undefined) return line;
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((waiter) => waiter.resolve === resolve);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error("Timed out waiting for SMTP response"));
      }, timeoutMs);
      this.waiters.push({ resolve, reject, timer });
    });
  }

  dispose() {
    this.socket.off("data", this.onData);
    this.socket.off("error", this.onError);
    this.socket.off("close", this.onClose);
    this.rejectAll(new Error("SMTP response reader disposed"));
  }

  private rejectAll(error: Error) {
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }
}

type SmtpResponse = { code: number; lines: string[] };

async function readResponse(reader: SmtpLineReader): Promise<SmtpResponse> {
  const first = await reader.readLine();
  const match = first.match(/^(\d{3})([ -])(.*)$/);
  if (!match) throw new Error("Malformed SMTP response");
  const code = Number(match[1]);
  const lines = [match[3] ?? ""];
  if (match[2] === " ") return { code, lines };

  while (true) {
    const line = await reader.readLine();
    const next = line.match(/^(\d{3})([ -])(.*)$/);
    if (!next || Number(next[1]) !== code) throw new Error("Malformed SMTP multiline response");
    lines.push(next[3] ?? "");
    if (next[2] === " ") return { code, lines };
  }
}

function expectCode(response: SmtpResponse, expected: number, action: string) {
  if (response.code !== expected) {
    throw new Error(`SMTP ${action} failed with ${response.code}: ${response.lines.join(" | ")}`);
  }
}

function writeLine(socket: SmtpSocket, value: string) {
  socket.write(`${value}\r\n`);
}

async function ehlo(socket: SmtpSocket, reader: SmtpLineReader) {
  writeLine(socket, "EHLO whatsapp-app");
  expectCode(await readResponse(reader), 250, "EHLO");
}

async function connectSmtp(config: SmtpEmailConfig): Promise<{ socket: SmtpSocket; reader: SmtpLineReader }> {
  if (config.security === "tls") {
    const socket = connectTls({
      host: config.host,
      port: config.port,
      servername: config.host,
      minVersion: "TLSv1.2",
    });
    const reader = new SmtpLineReader(socket);
    await once(socket, "secureConnect");
    expectCode(await readResponse(reader), 220, "greeting");
    await ehlo(socket, reader);
    return { socket, reader };
  }

  const plain = new Socket();
  const plainReader = new SmtpLineReader(plain);
  plain.connect(config.port, config.host);
  await once(plain, "connect");
  expectCode(await readResponse(plainReader), 220, "greeting");
  await ehlo(plain, plainReader);

  writeLine(plain, "STARTTLS");
  expectCode(await readResponse(plainReader), 220, "STARTTLS");
  plainReader.dispose();

  const socket = connectTls({
    socket: plain,
    servername: config.host,
    minVersion: "TLSv1.2",
  });
  const reader = new SmtpLineReader(socket);
  await once(socket, "secureConnect");
  await ehlo(socket, reader);
  return { socket, reader };
}

export async function sendSmtpEmail(
  config: SmtpEmailConfig,
  input: SmtpMailInput,
): Promise<{ messageId: string }> {
  const { message, messageId } = buildSmtpMessage({
    from: config.from,
    ...(config.replyTo ? { replyTo: config.replyTo } : {}),
    ...input,
  });
  const fromAddress = envelopeAddress(config.from);
  const recipient = envelopeAddress(input.to);
  let socket: SmtpSocket | undefined;
  let reader: SmtpLineReader | undefined;

  try {
    ({ socket, reader } = await connectSmtp(config));

    const auth = Buffer.from(`\0${config.username}\0${config.password}`, "utf8").toString("base64");
    writeLine(socket, `AUTH PLAIN ${auth}`);
    expectCode(await readResponse(reader), 235, "authentication");

    writeLine(socket, `MAIL FROM:<${fromAddress}>`);
    expectCode(await readResponse(reader), 250, "MAIL FROM");

    writeLine(socket, `RCPT TO:<${recipient}>`);
    const recipientResponse = await readResponse(reader);
    if (recipientResponse.code !== 250 && recipientResponse.code !== 251) {
      throw new Error(`SMTP RCPT TO failed with ${recipientResponse.code}: ${recipientResponse.lines.join(" | ")}`);
    }

    writeLine(socket, "DATA");
    expectCode(await readResponse(reader), 354, "DATA");

    socket.write(`${dotStuff(message)}\r\n.\r\n`);
    expectCode(await readResponse(reader), 250, "message delivery");

    writeLine(socket, "QUIT");
    const quit = await readResponse(reader).catch(() => null);
    if (quit && quit.code !== 221) {
      throw new Error(`SMTP QUIT failed with ${quit.code}`);
    }

    return { messageId };
  } finally {
    reader?.dispose();
    socket?.end();
  }
}

export class SmtpEmailProvider implements EmailProvider {
  constructor(private readonly config: SmtpEmailConfig) {}

  async send(input: Parameters<EmailProvider["send"]>[0]): Promise<{ messageId: string }> {
    return sendSmtpEmail(this.config, {
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      idempotencyKey: input.idempotencyKey,
    });
  }
}
