import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import type { WorkerEnv } from "@wa/config";
import { decryptSecret } from "@wa/credentials";
import { createDatabase, schema } from "@wa/db";
import { getWhatsAppPhoneNumber, MetaApiError } from "@wa/meta";
import { NotificationService } from "@wa/notifications";

type Database = ReturnType<typeof createDatabase>["db"];
type ConnectionStatus = "pending" | "connected" | "restricted" | "disconnected";
type HealthStatus = "unknown" | "healthy" | "degraded" | "reauthorization_required";

export type ConnectionHealthState = {
  healthStatus: HealthStatus;
  reauthorizationRequired: boolean;
  failureCode: string | null;
  failureReason: string | null;
};

export type ConnectionValidationOutcome =
  | { kind: "valid" }
  | { kind: "reauthorize"; code: string; reason: string }
  | { kind: "transient"; code: string; reason: string };

export type ConnectionReadiness =
  | { sendable: true }
  | { sendable: false; code: string; reason: string; requiresReauthorization: boolean };

const VALIDATION_INTERVAL_MS = 15 * 60_000;
const VALIDATION_BATCH_SIZE = 250;

export function isConnectionRevisionCurrent(expected: Date, current: Date): boolean {
  return expected.getTime() === current.getTime();
}

function metaErrorDetails(error: MetaApiError): { code: string | null; subcode: string | null } {
  if (!error.responseBody || typeof error.responseBody !== "object" || Array.isArray(error.responseBody)) {
    return { code: null, subcode: null };
  }
  const outer = error.responseBody as Record<string, unknown>;
  if (!outer.error || typeof outer.error !== "object" || Array.isArray(outer.error)) {
    return { code: null, subcode: null };
  }
  const detail = outer.error as Record<string, unknown>;
  const code = typeof detail.code === "number" || typeof detail.code === "string" ? String(detail.code) : null;
  const subcode = typeof detail.error_subcode === "number" || typeof detail.error_subcode === "string"
    ? String(detail.error_subcode)
    : null;
  return { code, subcode };
}

export function classifyMetaConnectionError(error: unknown): ConnectionValidationOutcome {
  if (!(error instanceof MetaApiError)) {
    return {
      kind: "transient",
      code: "meta_unavailable",
      reason: "Meta connection validation could not be completed. Sending can retry while the provider recovers.",
    };
  }

  const { code, subcode } = metaErrorDetails(error);
  if (error.status === 429 || error.status >= 500) {
    return {
      kind: "transient",
      code: "meta_unavailable",
      reason: "Meta is temporarily unavailable. The connection will be validated again automatically.",
    };
  }

  if (error.status === 401 || code === "190") {
    if (subcode === "463") {
      return {
        kind: "reauthorize",
        code: "credential_expired",
        reason: "The Meta credential has expired. Reconnect WhatsApp to resume sending.",
      };
    }
    return {
      kind: "reauthorize",
      code: "credential_invalid",
      reason: "The Meta credential is no longer valid. Reconnect WhatsApp to resume sending.",
    };
  }

  if (error.status === 403 || code === "10" || code === "200") {
    return {
      kind: "reauthorize",
      code: "credential_unusable",
      reason: "The Meta credential no longer has the access required for this WhatsApp number. Reconnect WhatsApp to resume sending.",
    };
  }

  return {
    kind: "transient",
    code: "connection_validation_failed",
    reason: "Meta could not validate this WhatsApp connection. The connection will be checked again automatically.",
  };
}

export function nextConnectionHealth(
  previous: ConnectionHealthState,
  outcome: ConnectionValidationOutcome,
): ConnectionHealthState {
  if (outcome.kind === "valid") {
    return {
      healthStatus: "healthy",
      reauthorizationRequired: false,
      failureCode: null,
      failureReason: null,
    };
  }

  if (outcome.kind === "reauthorize") {
    return {
      healthStatus: "reauthorization_required",
      reauthorizationRequired: true,
      failureCode: outcome.code,
      failureReason: outcome.reason,
    };
  }

  if (previous.reauthorizationRequired) return previous;
  return {
    healthStatus: "degraded",
    reauthorizationRequired: false,
    failureCode: outcome.code,
    failureReason: outcome.reason,
  };
}

export function connectionReadiness(input: {
  status: ConnectionStatus;
  reauthorizationRequired: boolean;
  failureCode: string | null;
  failureReason: string | null;
  credentialExpiresAt: Date | null;
}, now: Date): ConnectionReadiness {
  if (input.status !== "connected") {
    return {
      sendable: false,
      code: "connection_disconnected",
      reason: "This WhatsApp connection is not connected. Reconnect it before sending.",
      requiresReauthorization: false,
    };
  }

  if (input.reauthorizationRequired) {
    return {
      sendable: false,
      code: input.failureCode ?? "reauthorization_required",
      reason: input.failureReason ?? "This WhatsApp connection must be reauthorized before sending.",
      requiresReauthorization: true,
    };
  }

  if (input.credentialExpiresAt && input.credentialExpiresAt.getTime() <= now.getTime()) {
    return {
      sendable: false,
      code: "credential_expired",
      reason: "The Meta credential has expired. Reconnect WhatsApp to resume sending.",
      requiresReauthorization: true,
    };
  }

  return { sendable: true };
}

async function notifyWorkspaceAdmins(
  db: Database,
  input: {
    organizationId: string;
    phoneId: string;
    phoneNumber: string | null;
    code: string;
    transitionKey: string;
  },
) {
  try {
    const admins = await db
      .select({ userId: schema.organizationMembers.userId })
      .from(schema.organizationMembers)
      .where(and(
        eq(schema.organizationMembers.organizationId, input.organizationId),
        inArray(schema.organizationMembers.role, ["owner", "admin"]),
      ));
    if (!admins.length) return;

    const notifications = new NotificationService({ db });
    await notifications.emit({
      id: `whatsapp-connection:${input.phoneId}:${input.code}:${input.transitionKey}`,
      type: "whatsapp_connection_problem",
      organizationId: input.organizationId,
      userIds: admins.map((admin) => admin.userId),
      metadata: {
        phoneNumberId: input.phoneId,
        phoneNumber: input.phoneNumber,
        failureCode: input.code,
      },
      link: "/settings/whatsapp",
    });
  } catch (error) {
    // The durable health transition is more important than its alert side effect.
    // Email delivery reconciliation will handle successfully-created pending rows.
    console.error("WhatsApp connection health notification failed", {
      organizationId: input.organizationId,
      phoneId: input.phoneId,
      error,
    });
  }
}

export async function markConnectionRequiresReauthorization(
  db: Database,
  input: {
    organizationId: string;
    phoneNumberId: string;
    code: string;
    reason: string;
    validatedAt?: Date;
    expectedUpdatedAt?: Date;
  },
): Promise<boolean> {
  const existing = (
    await db
      .select({
        id: schema.whatsappPhoneNumbers.id,
        displayPhoneNumber: schema.whatsappPhoneNumbers.displayPhoneNumber,
        healthStatus: schema.whatsappPhoneNumbers.healthStatus,
        reauthorizationRequired: schema.whatsappPhoneNumbers.reauthorizationRequired,
        failureCode: schema.whatsappPhoneNumbers.failureCode,
        updatedAt: schema.whatsappPhoneNumbers.updatedAt,
      })
      .from(schema.whatsappPhoneNumbers)
      .where(and(
        eq(schema.whatsappPhoneNumbers.organizationId, input.organizationId),
        eq(schema.whatsappPhoneNumbers.phoneNumberId, input.phoneNumberId),
      ))
      .limit(1)
  )[0];
  if (!existing) return false;

  const validatedAt = input.validatedAt ?? new Date();
  if (input.expectedUpdatedAt && !isConnectionRevisionCurrent(input.expectedUpdatedAt, existing.updatedAt)) {
    return false;
  }
  const transitioned = !existing.reauthorizationRequired ||
    existing.healthStatus !== "reauthorization_required" ||
    existing.failureCode !== input.code;

  const [updated] = await db
    .update(schema.whatsappPhoneNumbers)
    .set({
      healthStatus: "reauthorization_required",
      reauthorizationRequired: true,
      failureCode: input.code,
      failureReason: input.reason,
      lastValidatedAt: validatedAt,
      updatedAt: validatedAt,
    })
    .where(and(
      eq(schema.whatsappPhoneNumbers.id, existing.id),
      eq(schema.whatsappPhoneNumbers.organizationId, input.organizationId),
      eq(schema.whatsappPhoneNumbers.updatedAt, existing.updatedAt),
    ))
    .returning({ id: schema.whatsappPhoneNumbers.id });

  if (!updated) return false;

  if (transitioned) {
    await notifyWorkspaceAdmins(db, {
      organizationId: input.organizationId,
      phoneId: existing.id,
      phoneNumber: existing.displayPhoneNumber,
      code: input.code,
      transitionKey: existing.updatedAt.toISOString(),
    });
  }
  return transitioned;
}

export async function prepareConnectionForSend(
  db: Database,
  input: {
    organizationId: string;
    phoneNumberId: string;
    credentialKey: string;
    now?: Date;
  },
): Promise<ConnectionReadiness> {
  const now = input.now ?? new Date();
  const connection = (
    await db
      .select({
        status: schema.whatsappPhoneNumbers.status,
        reauthorizationRequired: schema.whatsappPhoneNumbers.reauthorizationRequired,
        failureCode: schema.whatsappPhoneNumbers.failureCode,
        failureReason: schema.whatsappPhoneNumbers.failureReason,
        credentialExpiresAt: schema.whatsappPhoneNumbers.credentialExpiresAt,
      })
      .from(schema.whatsappPhoneNumbers)
      .where(and(
        eq(schema.whatsappPhoneNumbers.organizationId, input.organizationId),
        eq(schema.whatsappPhoneNumbers.phoneNumberId, input.phoneNumberId),
        eq(schema.whatsappPhoneNumbers.credentialKey, input.credentialKey),
      ))
      .limit(1)
  )[0];

  if (!connection) {
    return {
      sendable: false,
      code: "connection_unavailable",
      reason: "This WhatsApp connection is unavailable. Reconnect it before sending.",
      requiresReauthorization: false,
    };
  }

  const readiness = connectionReadiness(connection, now);
  if (!readiness.sendable) {
    if (readiness.requiresReauthorization && !connection.reauthorizationRequired) {
      await markConnectionRequiresReauthorization(db, {
        organizationId: input.organizationId,
        phoneNumberId: input.phoneNumberId,
        code: readiness.code,
        reason: readiness.reason,
        validatedAt: now,
      });
    }
    return readiness;
  }

  const credential = (
    await db
      .select({ id: schema.credentialSecrets.id })
      .from(schema.credentialSecrets)
      .where(and(
        eq(schema.credentialSecrets.organizationId, input.organizationId),
        eq(schema.credentialSecrets.key, input.credentialKey),
      ))
      .limit(1)
  )[0];
  if (credential) return { sendable: true };

  const missing = {
    kind: "reauthorize" as const,
    code: "credential_missing",
    reason: "The Meta credential is missing. Reconnect WhatsApp to resume sending.",
  };
  await markConnectionRequiresReauthorization(db, {
    organizationId: input.organizationId,
    phoneNumberId: input.phoneNumberId,
    code: missing.code,
    reason: missing.reason,
    validatedAt: now,
  });
  return {
    sendable: false,
    code: missing.code,
    reason: missing.reason,
    requiresReauthorization: true,
  };
}

async function validateConnection(
  db: Database,
  env: WorkerEnv,
  connection: {
    organizationId: string;
    phoneNumberId: string;
    credentialKey: string;
    credentialExpiresAt: Date | null;
    healthStatus: HealthStatus;
    reauthorizationRequired: boolean;
    failureCode: string | null;
    failureReason: string | null;
    updatedAt: Date;
  },
) {
  const validatedAt = new Date();
  const previous: ConnectionHealthState = {
    healthStatus: connection.healthStatus,
    reauthorizationRequired: connection.reauthorizationRequired,
    failureCode: connection.failureCode,
    failureReason: connection.failureReason,
  };

  if (connection.credentialExpiresAt && connection.credentialExpiresAt.getTime() <= validatedAt.getTime()) {
    await markConnectionRequiresReauthorization(db, {
      organizationId: connection.organizationId,
      phoneNumberId: connection.phoneNumberId,
      code: "credential_expired",
      reason: "The Meta credential has expired. Reconnect WhatsApp to resume sending.",
      validatedAt,
      expectedUpdatedAt: connection.updatedAt,
    });
    return;
  }

  const secret = (
    await db
      .select({
        ciphertext: schema.credentialSecrets.ciphertext,
        iv: schema.credentialSecrets.iv,
        authTag: schema.credentialSecrets.authTag,
      })
      .from(schema.credentialSecrets)
      .where(and(
        eq(schema.credentialSecrets.organizationId, connection.organizationId),
        eq(schema.credentialSecrets.key, connection.credentialKey),
      ))
      .limit(1)
  )[0];
  if (!secret) {
    await markConnectionRequiresReauthorization(db, {
      organizationId: connection.organizationId,
      phoneNumberId: connection.phoneNumberId,
      code: "credential_missing",
      reason: "The Meta credential is missing. Reconnect WhatsApp to resume sending.",
      validatedAt,
      expectedUpdatedAt: connection.updatedAt,
    });
    return;
  }

  let accessToken: string;
  try {
    accessToken = decryptSecret(secret, env.CREDENTIAL_ENCRYPTION_KEY);
  } catch {
    await markConnectionRequiresReauthorization(db, {
      organizationId: connection.organizationId,
      phoneNumberId: connection.phoneNumberId,
      code: "credential_unreadable",
      reason: "The Meta credential cannot be read. Reconnect WhatsApp to resume sending.",
      validatedAt,
      expectedUpdatedAt: connection.updatedAt,
    });
    return;
  }

  let outcome: ConnectionValidationOutcome = { kind: "valid" };
  try {
    await getWhatsAppPhoneNumber({
      phoneNumberId: connection.phoneNumberId,
      accessToken,
      graphApiVersion: env.META_GRAPH_API_VERSION,
    });
  } catch (error) {
    outcome = classifyMetaConnectionError(error);
  }

  if (outcome.kind === "reauthorize") {
    await markConnectionRequiresReauthorization(db, {
      organizationId: connection.organizationId,
      phoneNumberId: connection.phoneNumberId,
      code: outcome.code,
      reason: outcome.reason,
      validatedAt,
      expectedUpdatedAt: connection.updatedAt,
    });
    return;
  }

  const next = nextConnectionHealth(previous, outcome);
  await db
    .update(schema.whatsappPhoneNumbers)
    .set({
      healthStatus: next.healthStatus,
      reauthorizationRequired: next.reauthorizationRequired,
      failureCode: next.failureCode,
      failureReason: next.failureReason,
      lastValidatedAt: validatedAt,
      updatedAt: validatedAt,
    })
    .where(and(
      eq(schema.whatsappPhoneNumbers.organizationId, connection.organizationId),
      eq(schema.whatsappPhoneNumbers.phoneNumberId, connection.phoneNumberId),
      eq(schema.whatsappPhoneNumbers.updatedAt, connection.updatedAt),
    ));
}

export function startConnectionHealthMonitor(input: {
  db: Database;
  env: WorkerEnv;
}) {
  const runOnce = async () => {
    const staleBefore = new Date(Date.now() - VALIDATION_INTERVAL_MS);
    const connections = await input.db
      .select({
        organizationId: schema.whatsappPhoneNumbers.organizationId,
        phoneNumberId: schema.whatsappPhoneNumbers.phoneNumberId,
        credentialKey: schema.whatsappPhoneNumbers.credentialKey,
        credentialExpiresAt: schema.whatsappPhoneNumbers.credentialExpiresAt,
        healthStatus: schema.whatsappPhoneNumbers.healthStatus,
        reauthorizationRequired: schema.whatsappPhoneNumbers.reauthorizationRequired,
        failureCode: schema.whatsappPhoneNumbers.failureCode,
        failureReason: schema.whatsappPhoneNumbers.failureReason,
        updatedAt: schema.whatsappPhoneNumbers.updatedAt,
      })
      .from(schema.whatsappPhoneNumbers)
      .where(and(
        eq(schema.whatsappPhoneNumbers.status, "connected"),
        eq(schema.whatsappPhoneNumbers.reauthorizationRequired, false),
        or(
          isNull(schema.whatsappPhoneNumbers.lastValidatedAt),
          lt(schema.whatsappPhoneNumbers.lastValidatedAt, staleBefore),
        ),
      ))
      .limit(VALIDATION_BATCH_SIZE);

    for (const connection of connections) {
      try {
        await validateConnection(input.db, input.env, connection);
      } catch (error) {
        console.error("WhatsApp connection validation failed", {
          organizationId: connection.organizationId,
          phoneNumberId: connection.phoneNumberId,
          error,
        });
      }
    }
  };

  void runOnce().catch((error) => console.error("WhatsApp connection health scan failed", error));
  const timer = setInterval(() => {
    void runOnce().catch((error) => console.error("WhatsApp connection health scan failed", error));
  }, VALIDATION_INTERVAL_MS);
  timer.unref();

  return {
    runOnce,
    close() {
      clearInterval(timer);
    },
  };
}
