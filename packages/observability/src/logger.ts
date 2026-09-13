import * as Sentry from "@sentry/bun";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const REDACTED = "[REDACTED]";
const SENSITIVE_KEY = /authorization|cookie|token|secret|password|credential|api[_-]?key|access[_-]?key|private[_-]?key|encryption[_-]?key|presign/i;
const CREDENTIAL_URL = /\b(https?|postgres(?:ql)?|redis):\/\/[^\s/@:]+:[^\s/@]+@/gi;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+\/=:-]+/gi;
const QUERY_SECRET = /([?&](?:access_token|token|secret|password|api_key|key)=)[^&\s]+/gi;
const SAFE_SENTRY_HEADERS = new Set(["accept", "content-type", "host", "user-agent", "x-request-id", "x-forwarded-proto"]);
let sentryInitialized = false;

function scrubString(value: string): string {
  return value
    .replace(CREDENTIAL_URL, (_match, scheme: string) => `${scheme}://${REDACTED}@`)
    .replace(BEARER_TOKEN, `Bearer ${REDACTED}`)
    .replace(QUERY_SECRET, `$1${REDACTED}`);
}

function sanitize(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return scrubString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return String(value);
  if (depth >= 8) return "[MAX_DEPTH]";

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: scrubString(value.message),
    };
  }

  if (typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitize(item, depth + 1, seen));
  }

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY.test(key) ? REDACTED : sanitize(nested, depth + 1, seen);
  }
  return output;
}

export function sanitizeForLog(fields: LogFields): LogFields {
  return sanitize(fields, 0, new WeakSet<object>()) as LogFields;
}

function sentrySampleRate(): number {
  const parsed = Number.parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.05");
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0.05;
}

function initSentryIfConfigured(service: string) {
  if (sentryInitialized || !process.env.SENTRY_DSN) return;

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
    tracesSampleRate: sentrySampleRate(),
    sendDefaultPii: false,
    beforeSend(event) {
      delete event.user;

      if (event.request) {
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(event.request.headers ?? {})) {
          if (SAFE_SENTRY_HEADERS.has(key.toLowerCase()) && typeof value === "string") headers[key] = value;
        }
        event.request.headers = headers;
        if (event.request.url) event.request.url = event.request.url.split("?", 1)[0] ?? event.request.url;
        delete event.request.query_string;
        delete event.request.cookies;
        delete event.request.data;
        delete event.request.env;
      }

      if (event.extra) event.extra = sanitizeForLog(event.extra);
      if (event.contexts) {
        for (const [key, context] of Object.entries(event.contexts)) {
          if (context && typeof context === "object") {
            event.contexts[key] = sanitizeForLog(context as LogFields);
          }
        }
      }
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((breadcrumb) => ({
          ...breadcrumb,
          ...(breadcrumb.data ? { data: sanitizeForLog(breadcrumb.data) } : {}),
        }));
      }

      return event;
    },
    initialScope: {
      tags: { service },
    },
  });

  sentryInitialized = true;
}

function safeError(error: Error): Error {
  const sanitized = sanitizeForLog({ message: error.message });
  const message = typeof sanitized.message === "string" ? sanitized.message : "Unhandled error";
  const result = new Error(message);
  result.name = error.name;
  if (error.stack) {
    const stackLines = error.stack.split("\n");
    result.stack = [`${result.name}: ${result.message}`, ...stackLines.slice(1)].join("\n");
  }
  return result;
}

function reportError(service: string, event: string, fields: LogFields, context: LogFields) {
  if (!sentryInitialized) return;
  try {
    const safeFields = sanitizeForLog({ ...context, ...fields });
    Sentry.withScope((scope) => {
      scope.setTag("service", service);
      scope.setTag("log.event", event);
      scope.setContext("log", safeFields);
      if (fields.error instanceof Error) Sentry.captureException(safeError(fields.error));
      else Sentry.captureMessage(event, "error");
    });
  } catch {
    // Observability must never make the application fail.
  }
}

export interface Logger {
  child(fields: LogFields): Logger;
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

export function createLogger(options: { service: string; base?: LogFields }): Logger {
  initSentryIfConfigured(options.service);
  const base = sanitizeForLog(options.base ?? {});

  const build = (childFields: LogFields): Logger => {
    const context = sanitizeForLog({ ...base, ...childFields });

    const write = (level: LogLevel, event: string, fields: LogFields = {}) => {
      const entry = sanitizeForLog({
        ...context,
        ...fields,
        timestamp: new Date().toISOString(),
        level,
        service: options.service,
        event,
      });
      const line = `${JSON.stringify(entry)}\n`;
      if (level === "error" || level === "warn") process.stderr.write(line);
      else process.stdout.write(line);
      if (level === "error") reportError(options.service, event, fields, context);
    };

    return {
      child: (fields) => build({ ...context, ...fields }),
      debug: (event, fields) => write("debug", event, fields),
      info: (event, fields) => write("info", event, fields),
      warn: (event, fields) => write("warn", event, fields),
      error: (event, fields) => write("error", event, fields),
    };
  };

  return build({});
}
