export type EmbeddedSignupData = {
  wabaId: string;
  phoneNumberId: string;
  businessId?: string;
};

export type EmbeddedSignupLoginOptions = {
  config_id: string;
  response_type: "code";
  override_default_response_type: true;
  extras: {
    setup: Record<string, never>;
  };
};

export type EmbeddedSignupMessage =
  | { kind: "ignore" }
  | { kind: "cancel" }
  | { kind: "error" }
  | { kind: "invalid" }
  | { kind: "finish"; data: EmbeddedSignupData };

export type EmbeddedSignupReadyAttempt = {
  kind: "ready";
  attemptId: number;
  code: string;
  signup: EmbeddedSignupData;
};

export type EmbeddedSignupAttemptOutcome =
  | { kind: "ignore" }
  | { kind: "pending" }
  | { kind: "terminal"; reason: "cancelled" | "failed" | "no_code"; requiresReload: boolean }
  | EmbeddedSignupReadyAttempt;

type ActiveAttempt = {
  id: number;
  source: object | null;
  code: string | null;
  signup: EmbeddedSignupData | null;
  completing: boolean;
};

const FACEBOOK_EMBEDDED_SIGNUP_ORIGINS = new Set([
  "https://www.facebook.com",
  "https://web.facebook.com",
]);

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export class EmbeddedSignupAttemptTracker {
  private nextAttemptId = 1;
  private active: ActiveAttempt | null = null;
  private readonly retiredSources = new WeakSet<object>();
  private reloadRequired = false;

  begin(): number | null {
    if (this.reloadRequired || this.active) return null;
    const id = this.nextAttemptId++;
    this.active = { id, source: null, code: null, signup: null, completing: false };
    return id;
  }

  acceptLoginResponse(attemptId: number, rawCode: unknown): EmbeddedSignupAttemptOutcome {
    const active = this.active;
    if (!active || active.id !== attemptId || active.completing) return { kind: "ignore" };
    const code = nonEmptyString(rawCode);
    if (!code) return this.endAttempt(active, "no_code");
    active.code = code;
    return this.maybeReady(active);
  }

  acceptMessage(source: object | null, message: EmbeddedSignupMessage): EmbeddedSignupAttemptOutcome {
    if (message.kind === "ignore") return { kind: "ignore" };
    const active = this.active;
    if (!active || active.completing) return { kind: "ignore" };

    if (!source) {
      this.active = null;
      this.reloadRequired = true;
      return { kind: "terminal", reason: "failed", requiresReload: true };
    }

    if (this.retiredSources.has(source)) return { kind: "ignore" };
    if (active.source && active.source !== source) return { kind: "ignore" };
    active.source = source;

    if (message.kind === "cancel") return this.endAttempt(active, "cancelled");
    if (message.kind === "error" || message.kind === "invalid") return this.endAttempt(active, "failed");

    active.signup = message.data;
    return this.maybeReady(active);
  }

  abortAttempt(attemptId: number): EmbeddedSignupAttemptOutcome {
    const active = this.active;
    if (!active || active.id !== attemptId) return { kind: "ignore" };
    return this.endAttempt(active, "failed");
  }

  completionSucceeded(attemptId: number): void {
    this.clearCompletedAttempt(attemptId);
  }

  completionFailed(attemptId: number): boolean {
    const active = this.active;
    if (!active || active.id !== attemptId) return this.reloadRequired;
    const requiresReload = active.source === null;
    this.retire(active.source);
    this.active = null;
    if (requiresReload) this.reloadRequired = true;
    return requiresReload;
  }

  private maybeReady(active: ActiveAttempt): EmbeddedSignupAttemptOutcome {
    if (!active.code || !active.signup) return { kind: "pending" };
    active.completing = true;
    return { kind: "ready", attemptId: active.id, code: active.code, signup: active.signup };
  }

  private endAttempt(
    active: ActiveAttempt,
    reason: "cancelled" | "failed" | "no_code",
  ): EmbeddedSignupAttemptOutcome {
    const requiresReload = active.source === null;
    this.retire(active.source);
    this.active = null;
    if (requiresReload) this.reloadRequired = true;
    return { kind: "terminal", reason, requiresReload };
  }

  private clearCompletedAttempt(attemptId: number): void {
    const active = this.active;
    if (!active || active.id !== attemptId) return;
    this.retire(active.source);
    this.active = null;
  }

  private retire(source: object | null): void {
    if (source) this.retiredSources.add(source);
  }
}

export function createEmbeddedSignupLoginOptions(configId: string): EmbeddedSignupLoginOptions {
  return {
    config_id: configId,
    response_type: "code",
    override_default_response_type: true,
    extras: { setup: {} },
  };
}

export function parseEmbeddedSignupMessage(origin: string, rawPayload: unknown): EmbeddedSignupMessage {
  if (!FACEBOOK_EMBEDDED_SIGNUP_ORIGINS.has(origin)) return { kind: "ignore" };

  let payload = rawPayload;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload) as unknown;
    } catch {
      return { kind: "ignore" };
    }
  }

  if (!payload || typeof payload !== "object") return { kind: "ignore" };
  const record = payload as Record<string, unknown>;
  if (record.type !== "WA_EMBEDDED_SIGNUP") return { kind: "ignore" };
  if (record.event === "CANCEL") return { kind: "cancel" };
  if (record.event === "ERROR") return { kind: "error" };
  if (record.event !== "FINISH") return { kind: "invalid" };
  if (!record.data || typeof record.data !== "object") return { kind: "invalid" };

  const data = record.data as Record<string, unknown>;
  const wabaId = nonEmptyString(data.waba_id);
  const phoneNumberId = nonEmptyString(data.phone_number_id);
  if (!wabaId || !phoneNumberId) return { kind: "invalid" };

  const businessId = data.business_id === undefined ? null : nonEmptyString(data.business_id);
  if (data.business_id !== undefined && !businessId) return { kind: "invalid" };

  return {
    kind: "finish",
    data: {
      wabaId,
      phoneNumberId,
      ...(businessId ? { businessId } : {}),
    },
  };
}
