export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const REDACTED = "[REDACTED]";
const SENSITIVE_KEY = /authorization|cookie|token|secret|password|credential|api[_-]?key|access[_-]?key|private[_-]?key|encryption[_-]?key|presign/i;
const CREDENTIAL_URL = /\b(https?|postgres(?:ql)?|redis):\/\/[^\s/@:]+:[^\s/@]+@/gi;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+\/=:-]+/gi;
const QUERY_SECRET = /([?&](?:access_token|token|secret|password|api_key|key)=)[^&\s]+/gi;

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

export interface Logger {
  child(fields: LogFields): Logger;
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

export function createLogger(options: { service: string; base?: LogFields }): Logger {
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
