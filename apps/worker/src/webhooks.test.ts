import { describe, expect, test } from "bun:test";
import {
  MAX_WEBHOOK_PROCESSING_ATTEMPTS,
  WEBHOOK_STALE_PROCESSING_MS,
  WEBHOOK_UNPROCESSED_THRESHOLD_MS,
  shouldReconcileWebhookEvent,
  webhookRecipientStatusAfter,
  webhookRetryDelayMs,
} from "./webhooks";

describe("webhook delivery status monotonicity", () => {
  test("out-of-order sent/delivered/read events never regress a recipient", () => {
    let status = webhookRecipientStatusAfter("submitted", "delivered");
    expect(status).toBe("delivered");

    status = webhookRecipientStatusAfter(status, "sent");
    expect(status).toBe("delivered");

    status = webhookRecipientStatusAfter(status, "read");
    expect(status).toBe("read");

    status = webhookRecipientStatusAfter(status, "delivered");
    expect(status).toBe("read");
  });

  test("failed never overwrites delivered or read", () => {
    expect(webhookRecipientStatusAfter("delivered", "failed")).toBe("delivered");
    expect(webhookRecipientStatusAfter("read", "failed")).toBe("read");
  });

  test("preserves existing failed-before-read business rule", () => {
    expect(webhookRecipientStatusAfter("failed", "read")).toBe("failed");
  });

  test("a recipient skipped by a concurrent control action stays skipped", () => {
    for (const incoming of ["sent", "delivered", "read", "failed"] as const) {
      expect(webhookRecipientStatusAfter("skipped", incoming)).toBe("skipped");
    }
  });
});

describe("webhook retry strategy", () => {
  test("uses bounded exponential retry delays", () => {
    expect(webhookRetryDelayMs(1)).toBe(1_000);
    expect(webhookRetryDelayMs(2)).toBe(2_000);
    expect(webhookRetryDelayMs(3)).toBe(4_000);
    expect(webhookRetryDelayMs(MAX_WEBHOOK_PROCESSING_ATTEMPTS)).toBeLessThanOrEqual(5 * 60_000);
    expect(webhookRetryDelayMs(100)).toBe(5 * 60_000);
  });
});

describe("webhook durable inbox reconciliation", () => {
  const now = new Date("2026-09-13T12:00:00.000Z");

  test("detects persisted events that were never queued or were lost with Redis", () => {
    expect(shouldReconcileWebhookEvent({
      processingStatus: "pending",
      createdAt: new Date(now.getTime() - WEBHOOK_UNPROCESSED_THRESHOLD_MS - 1),
      processingStartedAt: null,
      nextRetryAt: null,
    }, now)).toBe("never_queued");
  });

  test("does not duplicate a fresh pending event", () => {
    expect(shouldReconcileWebhookEvent({
      processingStatus: "pending",
      createdAt: new Date(now.getTime() - WEBHOOK_UNPROCESSED_THRESHOLD_MS + 1),
      processingStartedAt: null,
      nextRetryAt: null,
    }, now)).toBeNull();
  });

  test("recovers a worker crash that left a stale processing claim", () => {
    expect(shouldReconcileWebhookEvent({
      processingStatus: "processing",
      createdAt: new Date(now.getTime() - 120_000),
      processingStartedAt: new Date(now.getTime() - WEBHOOK_STALE_PROCESSING_MS - 1),
      nextRetryAt: null,
    }, now)).toBe("stale_processing");
  });

  test("treats the stale processing threshold as recoverable", () => {
    expect(shouldReconcileWebhookEvent({
      processingStatus: "processing",
      createdAt: new Date(now.getTime() - 120_000),
      processingStartedAt: new Date(now.getTime() - WEBHOOK_STALE_PROCESSING_MS),
      nextRetryAt: null,
    }, now)).toBe("stale_processing");
  });

  test("does not reclaim a fresh processing claim", () => {
    expect(shouldReconcileWebhookEvent({
      processingStatus: "processing",
      createdAt: new Date(now.getTime() - 120_000),
      processingStartedAt: new Date(now.getTime() - WEBHOOK_STALE_PROCESSING_MS + 1),
      nextRetryAt: null,
    }, now)).toBeNull();
  });

  test("requeues only retries whose backoff has expired", () => {
    expect(shouldReconcileWebhookEvent({
      processingStatus: "retry",
      createdAt: new Date(now.getTime() - 120_000),
      processingStartedAt: null,
      nextRetryAt: new Date(now.getTime() - 1),
    }, now)).toBe("retry_due");

    expect(shouldReconcileWebhookEvent({
      processingStatus: "retry",
      createdAt: new Date(now.getTime() - 120_000),
      processingStartedAt: null,
      nextRetryAt: new Date(now.getTime() + 1),
    }, now)).toBeNull();
  });
});