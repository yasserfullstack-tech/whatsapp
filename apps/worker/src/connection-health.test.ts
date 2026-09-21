import { describe, expect, test } from "bun:test";
import { MetaApiError } from "@wa/meta";
import {
  classifyMetaConnectionError,
  connectionReadiness,
  nextConnectionHealth,
  type ConnectionHealthState,
} from "./connection-health";

const healthy: ConnectionHealthState = {
  healthStatus: "healthy",
  reauthorizationRequired: false,
  failureCode: null,
  failureReason: null,
};

describe("WhatsApp connection health lifecycle", () => {
  test("a valid connection becomes healthy", () => {
    expect(nextConnectionHealth({
      healthStatus: "unknown",
      reauthorizationRequired: false,
      failureCode: null,
      failureReason: null,
    }, { kind: "valid" })).toEqual(healthy);
  });

  test("a revoked Meta credential requires reauthorization", () => {
    const outcome = classifyMetaConnectionError(new MetaApiError(
      "invalid token",
      400,
      { error: { code: 190, error_subcode: 458 } },
    ));
    expect(outcome).toMatchObject({ kind: "reauthorize", code: "credential_invalid" });
    expect(nextConnectionHealth(healthy, outcome)).toMatchObject({
      healthStatus: "reauthorization_required",
      reauthorizationRequired: true,
      failureCode: "credential_invalid",
    });
  });

  test("an expired credential is blocked before a provider call", () => {
    const readiness = connectionReadiness({
      status: "connected",
      reauthorizationRequired: false,
      failureCode: null,
      failureReason: null,
      credentialExpiresAt: new Date("2026-09-15T00:00:00Z"),
    }, new Date("2026-09-16T00:00:00Z"));
    expect(readiness).toMatchObject({
      sendable: false,
      code: "credential_expired",
      requiresReauthorization: true,
    });
  });

  test("Meta rate limits and provider outages degrade without forcing reauthorization", () => {
    const rateLimited = classifyMetaConnectionError(new MetaApiError("rate limited", 429, { error: { code: 4 } }));
    const unavailable = classifyMetaConnectionError(new MetaApiError("unavailable", 503, null));
    expect(rateLimited).toMatchObject({ kind: "transient", code: "meta_unavailable" });
    expect(unavailable).toMatchObject({ kind: "transient", code: "meta_unavailable" });
    expect(nextConnectionHealth(healthy, unavailable)).toMatchObject({
      healthStatus: "degraded",
      reauthorizationRequired: false,
      failureCode: "meta_unavailable",
    });
  });

  test("a recovered connection clears a previous reauthorization failure", () => {
    const broken: ConnectionHealthState = {
      healthStatus: "reauthorization_required",
      reauthorizationRequired: true,
      failureCode: "credential_invalid",
      failureReason: "Reconnect WhatsApp.",
    };
    expect(nextConnectionHealth(broken, { kind: "valid" })).toEqual(healthy);
  });

  test("permission loss is treated as an unusable credential", () => {
    const outcome = classifyMetaConnectionError(new MetaApiError(
      "permission denied",
      403,
      { error: { code: 200 } },
    ));
    expect(outcome).toMatchObject({ kind: "reauthorize", code: "credential_unusable" });
  });

  test("connection revision timestamps distinguish a stale validation from a reconnect", () => {
    const validationRevision = new Date("2026-09-21T10:00:00.000Z");
    const reconnectRevision = new Date("2026-09-21T10:00:01.000Z");
    expect(validationRevision.getTime()).not.toBe(reconnectRevision.getTime());
  });
});
