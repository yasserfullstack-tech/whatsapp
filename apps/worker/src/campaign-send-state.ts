import { and, eq, gt, isNull } from "drizzle-orm";
import { createDatabase, schema } from "@wa/db";
import { MetaApiError } from "@wa/meta";
import type { SendMessageJob } from "@wa/queue";

type Database = ReturnType<typeof createDatabase>["db"];

export const UNKNOWN_SEND_OUTCOME_ERROR = "Previous send attempt ended without a recorded Meta outcome; automatic resend suppressed to prevent duplicate delivery";
export const UNKNOWN_SEND_OUTCOME_CODE = "send_outcome_unknown";

export function errorText(error: unknown): string {
  if (error instanceof MetaApiError) {
    let body = "";
    try {
      body = JSON.stringify(error.responseBody);
    } catch {
      body = "";
    }
    return `${error.message} (${error.status})${body ? ` ${body}` : ""}`.slice(0, 2_000);
  }
  return (error instanceof Error ? error.message : "Unknown send error").slice(0, 2_000);
}

export function errorCode(error: unknown): string | null {
  if (!(error instanceof MetaApiError) || !error.responseBody || typeof error.responseBody !== "object") return null;
  const outer = error.responseBody as Record<string, unknown>;
  if (!outer.error || typeof outer.error !== "object") return String(error.status);
  const metaError = outer.error as Record<string, unknown>;
  return typeof metaError.code === "number" || typeof metaError.code === "string"
    ? String(metaError.code)
    : String(error.status);
}

export type MetaSendErrorDisposition =
  | { kind: "permanent"; code: string }
  | { kind: "throughput"; code: string; retryAfterMs: number }
  | { kind: "ambiguous"; code: string }
  | { kind: "transient"; code: string };

const PERMANENT_META_SEND_CODES = new Set(["100", "131026", "132000", "132001"]);
const THROUGHPUT_META_SEND_CODES = new Set(["130429", "131048", "80007"]);

export function classifyMetaSendError(error: MetaApiError): MetaSendErrorDisposition {
  const code = errorCode(error) ?? String(error.status);

  if (THROUGHPUT_META_SEND_CODES.has(code) || error.status === 429) {
    return { kind: "throughput", code, retryAfterMs: 30_000 };
  }

  if (PERMANENT_META_SEND_CODES.has(code)) {
    return { kind: "permanent", code };
  }

  if (error.status >= 500 || error.status < 200) {
    return { kind: "ambiguous", code };
  }

  // Meta can return HTTP 2xx while omitting a wamid. The client surfaces that
  // as MetaApiError, and retrying could duplicate a provider-accepted send.
  if (error.status >= 200 && error.status < 300) {
    return { kind: "ambiguous", code };
  }

  return { kind: "transient", code };
}

export function createCampaignSendState(db: Database) {
  const markUnknownSendOutcome = async (
    recipientId: string,
    campaignId: string,
    organizationId: string,
    detail?: string,
  ) => {
    const failedAt = new Date();
    const suffix = detail?.trim() ? `: ${detail.trim()}` : "";
    const [failed] = await db
      .update(schema.campaignRecipients)
      .set({
        status: "failed",
        lastError: `${UNKNOWN_SEND_OUTCOME_ERROR}${suffix}`.slice(0, 2_000),
        errorCode: UNKNOWN_SEND_OUTCOME_CODE,
        failedAt,
        updatedAt: failedAt,
      })
      .where(
        and(
          eq(schema.campaignRecipients.id, recipientId),
          eq(schema.campaignRecipients.campaignId, campaignId),
          eq(schema.campaignRecipients.organizationId, organizationId),
          eq(schema.campaignRecipients.status, "queued"),
          gt(schema.campaignRecipients.attemptCount, 0),
          isNull(schema.campaignRecipients.lastError),
          isNull(schema.campaignRecipients.wamid),
        ),
      )
      .returning({ id: schema.campaignRecipients.id });
    return Boolean(failed);
  };

  const failQueuedRecipientForConnection = async (
    job: SendMessageJob,
    failure: { code: string; reason: string },
  ) => {
    const failedAt = new Date();
    await db
      .update(schema.campaignRecipients)
      .set({
        status: "failed",
        lastError: failure.reason.slice(0, 2_000),
        errorCode: failure.code,
        failedAt,
        updatedAt: failedAt,
      })
      .where(and(
        eq(schema.campaignRecipients.id, job.recipientId),
        eq(schema.campaignRecipients.campaignId, job.campaignId),
        eq(schema.campaignRecipients.organizationId, job.organizationId),
        eq(schema.campaignRecipients.status, "queued"),
        eq(schema.campaignRecipients.queuedAt, new Date(job.reservationQueuedAt)),
        isNull(schema.campaignRecipients.wamid),
      ));
  };

  return {
    markUnknownSendOutcome,
    failQueuedRecipientForConnection,
  };
}
