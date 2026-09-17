import { describe, expect, test } from "bun:test";
import {
  REQUIRED_FLOW_IDS,
  renderSummary,
  validateManifest,
} from "./validate-provider-evidence";

const RECOVERY_REQUIRED = new Set([
  "deliberate_send_failure",
  "credential_invalidation_reconnect",
  "billing_lifecycle",
  "backup_restore",
  "release_rollback",
]);

function passingManifest() {
  return {
    schemaVersion: 1,
    environment: "staging",
    executedAt: "2026-09-17T08:00:00Z",
    operator: "release-engineer",
    release: {
      commit: "a".repeat(40),
      images: {
        web: `sha256:${"b".repeat(64)}`,
        api: `sha256:${"c".repeat(64)}`,
        worker: `sha256:${"d".repeat(64)}`,
        migrator: `sha256:${"e".repeat(64)}`,
      },
    },
    flows: REQUIRED_FLOW_IDS.map((id) => {
      if (id === "account_export") {
        return {
          id,
          status: "not_applicable",
          recoveryStatus: "not_applicable",
          evidence: [],
          recoveryEvidence: [],
          notes: "Workspace export is not part of the supported launch product scope.",
        };
      }

      const recoveryRequired = RECOVERY_REQUIRED.has(id);
      return {
        id,
        status: "pass",
        recoveryStatus: recoveryRequired ? "pass" : "not_applicable",
        evidence: [`provider-ref:${id}`],
        recoveryEvidence: recoveryRequired ? [`recovery-ref:${id}`] : [],
        notes: "",
      };
    }),
  };
}

describe("PR-012 provider evidence validator", () => {
  test("accepts a complete launch-signoff manifest", () => {
    const manifest = passingManifest();
    expect(validateManifest(manifest, { requirePass: true })).toEqual([]);
    expect(renderSummary(manifest)).toContain("PR-012 real-provider validation evidence");
    expect(renderSummary(manifest)).toContain("Meta Embedded Signup");
  });

  test("rejects missing required flows", () => {
    const manifest = passingManifest();
    manifest.flows = manifest.flows.filter((flow) => flow.id !== "whatsapp_send");
    expect(validateManifest(manifest, { requirePass: true })).toContain(
      "missing required flow: whatsapp_send",
    );
  });

  test("rejects unresolved recovery paths in launch-signoff mode", () => {
    const manifest = passingManifest();
    const flow = manifest.flows.find(
      (candidate) => candidate.id === "credential_invalidation_reconnect",
    );
    if (!flow) throw new Error("test fixture is missing credential flow");
    flow.recoveryStatus = "pending";
    flow.recoveryEvidence = [];

    expect(validateManifest(manifest, { requirePass: true })).toContain(
      "flows[6]: credential_invalidation_reconnect recovery path must pass before launch sign-off",
    );
  });

  test("rejects placeholder release identity in launch-signoff mode", () => {
    const manifest = passingManifest();
    manifest.release.commit = "0".repeat(40);
    manifest.release.images.web = `sha256:${"0".repeat(64)}`;
    const errors = validateManifest(manifest, { requirePass: true });
    expect(errors).toContain(
      "release.commit cannot be the placeholder SHA in --require-pass mode",
    );
    expect(errors).toContain(
      "release.images.web cannot be the placeholder digest in --require-pass mode",
    );
  });

  test("rejects common secrets and PII", () => {
    const manifest = passingManifest();
    manifest.flows[0]!.notes = "accidentally captured +15551234567";
    manifest.flows[1]!.evidence = ["Bearer do-not-store-this"];
    manifest.flows[2]!.notes = "recipient@example.com";
    const errors = validateManifest(manifest);

    expect(errors.some((error) => error.includes("E.164 phone number"))).toBe(true);
    expect(errors.some((error) => error.includes("Bearer credential"))).toBe(true);
    expect(errors.some((error) => error.includes("email address"))).toBe(true);
  });

  test("only allows account export to be not applicable", () => {
    const manifest = passingManifest();
    const flow = manifest.flows.find((candidate) => candidate.id === "email_delivery");
    if (!flow) throw new Error("test fixture is missing email flow");
    flow.status = "not_applicable";
    flow.notes = "not configured";

    expect(validateManifest(manifest)).toContain(
      "flows[9]: email_delivery cannot be marked not_applicable",
    );
  });
});
