type ValidationStatus = "pending" | "pass" | "fail" | "not_applicable";

type EvidenceFlow = {
  id?: unknown;
  status?: unknown;
  recoveryStatus?: unknown;
  evidence?: unknown;
  recoveryEvidence?: unknown;
  notes?: unknown;
};

type EvidenceManifest = {
  schemaVersion?: unknown;
  environment?: unknown;
  executedAt?: unknown;
  operator?: unknown;
  release?: unknown;
  flows?: unknown;
};

export const REQUIRED_FLOW_IDS = [
  "meta_embedded_signup",
  "whatsapp_send",
  "delivery_read_status",
  "deliberate_send_failure",
  "inbound_message",
  "opt_out",
  "credential_invalidation_reconnect",
  "meta_asset_sync",
  "r2_upload_import",
  "email_delivery",
  "full_campaign_dispatch",
  "account_export",
  "account_deletion",
  "billing_lifecycle",
  "backup_restore",
  "release_rollback",
] as const;

const FLOW_LABELS: Record<(typeof REQUIRED_FLOW_IDS)[number], string> = {
  meta_embedded_signup: "Meta Embedded Signup",
  whatsapp_send: "WhatsApp send",
  delivery_read_status: "Delivery/read status",
  deliberate_send_failure: "Deliberate send failure",
  inbound_message: "Inbound message",
  opt_out: "Opt-out behavior",
  credential_invalidation_reconnect: "Credential invalidation/reconnect",
  meta_asset_sync: "Meta asset/account sync",
  r2_upload_import: "R2 upload/import",
  email_delivery: "Email delivery",
  full_campaign_dispatch: "Full campaign dispatch",
  account_export: "Workspace/account export",
  account_deletion: "Permanent workspace/account deletion",
  billing_lifecycle: "Billing lifecycle",
  backup_restore: "Backup/restore",
  release_rollback: "Release rollback",
};

const STATUS_VALUES = new Set<ValidationStatus>([
  "pending",
  "pass",
  "fail",
  "not_applicable",
]);

const RECOVERY_REQUIRED = new Set<(typeof REQUIRED_FLOW_IDS)[number]>([
  "deliberate_send_failure",
  "credential_invalidation_reconnect",
  "billing_lifecycle",
  "backup_restore",
  "release_rollback",
]);

const IMAGE_KEYS = ["web", "api", "worker", "migrator"] as const;
const OPTIONAL_NOT_APPLICABLE = new Set<(typeof REQUIRED_FLOW_IDS)[number]>([
  "account_export",
]);

const FORBIDDEN_KEY =
  /(?:^|_)(?:access_token|refresh_token|token|secret|password|authorization_code|oauth_code|phone_number|message_body|message_content|customer_email|customer_name|access_key|private_key)(?:$|_)/i;

const FORBIDDEN_VALUE_PATTERNS: Array<[RegExp, string]> = [
  [/\bBearer\s+\S+/i, "Bearer credential"],
  [/\bsk_(?:live|test)_[A-Za-z0-9]+\b/, "payment-provider secret key"],
  [/\bwhsec_[A-Za-z0-9]+\b/, "payment-provider webhook secret"],
  [/\bAKIA[0-9A-Z]{16}\b/, "cloud access key"],
  [/\bEAA[A-Za-z0-9]{20,}\b/, "Meta access token"],
  [/(?:^|\s)\+[1-9][0-9]{7,14}\b/, "E.164 phone number"],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, "email address"],
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyStrings(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string" && item.trim().length > 0)
  );
}

function scanForSensitiveData(value: unknown, path: string, errors: string[]): void {
  if (typeof value === "string") {
    for (const [pattern, label] of FORBIDDEN_VALUE_PATTERNS) {
      if (pattern.test(value)) {
        errors.push(`${path}: possible ${label} must be redacted`);
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForSensitiveData(item, `${path}[${index}]`, errors));
    return;
  }

  if (!isRecord(value)) return;

  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = `${path}.${key}`;
    if (FORBIDDEN_KEY.test(key)) {
      errors.push(`${nestedPath}: sensitive field names are not allowed in evidence manifests`);
    }
    scanForSensitiveData(nested, nestedPath, errors);
  }
}

export function validateManifest(
  manifest: EvidenceManifest,
  options: { requirePass?: boolean } = {},
): string[] {
  const errors: string[] = [];
  const requirePass = options.requirePass === true;

  if (manifest.schemaVersion !== 1) {
    errors.push("schemaVersion must equal 1");
  }

  if (manifest.environment !== "staging" && manifest.environment !== "production") {
    errors.push("environment must be staging or production");
  }

  if (
    typeof manifest.executedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T/.test(manifest.executedAt) ||
    Number.isNaN(Date.parse(manifest.executedAt))
  ) {
    errors.push("executedAt must be a valid ISO-8601 timestamp");
  }

  if (typeof manifest.operator !== "string" || manifest.operator.trim().length === 0) {
    errors.push("operator must be a non-empty role/name reference");
  }

  if (!isRecord(manifest.release)) {
    errors.push("release must be an object");
  } else {
    const commit = manifest.release.commit;
    if (typeof commit !== "string" || !/^[0-9a-f]{40}$/i.test(commit)) {
      errors.push("release.commit must be a full 40-character Git SHA");
    } else if (requirePass && /^0{40}$/.test(commit)) {
      errors.push("release.commit cannot be the placeholder SHA in --require-pass mode");
    }

    const images = manifest.release.images;
    if (!isRecord(images)) {
      errors.push("release.images must contain immutable image digests");
    } else {
      for (const imageKey of IMAGE_KEYS) {
        const digest = images[imageKey];
        if (typeof digest !== "string" || !/^sha256:[0-9a-f]{64}$/i.test(digest)) {
          errors.push(`release.images.${imageKey} must be a sha256 digest`);
        } else if (requirePass && /^sha256:0{64}$/.test(digest)) {
          errors.push(
            `release.images.${imageKey} cannot be the placeholder digest in --require-pass mode`,
          );
        }
      }
    }
  }

  if (!Array.isArray(manifest.flows)) {
    errors.push("flows must be an array");
  } else {
    const seen = new Set<string>();
    const required = new Set<string>(REQUIRED_FLOW_IDS);

    for (const [index, rawFlow] of manifest.flows.entries()) {
      const prefix = `flows[${index}]`;
      if (!isRecord(rawFlow)) {
        errors.push(`${prefix} must be an object`);
        continue;
      }

      const flow = rawFlow as EvidenceFlow;
      if (typeof flow.id !== "string" || !required.has(flow.id)) {
        errors.push(`${prefix}.id must be one of the required PR-012 flow IDs`);
        continue;
      }

      const id = flow.id as (typeof REQUIRED_FLOW_IDS)[number];
      if (seen.has(id)) {
        errors.push(`${prefix}.id duplicates ${id}`);
      }
      seen.add(id);

      if (typeof flow.status !== "string" || !STATUS_VALUES.has(flow.status as ValidationStatus)) {
        errors.push(`${prefix}.status is invalid`);
      }

      if (
        typeof flow.recoveryStatus !== "string" ||
        !STATUS_VALUES.has(flow.recoveryStatus as ValidationStatus)
      ) {
        errors.push(`${prefix}.recoveryStatus is invalid`);
      }

      if (!Array.isArray(flow.evidence) || !flow.evidence.every((item) => typeof item === "string")) {
        errors.push(`${prefix}.evidence must be an array of sanitized reference strings`);
      }
      if (
        !Array.isArray(flow.recoveryEvidence) ||
        !flow.recoveryEvidence.every((item) => typeof item === "string")
      ) {
        errors.push(
          `${prefix}.recoveryEvidence must be an array of sanitized reference strings`,
        );
      }
      if (typeof flow.notes !== "string") {
        errors.push(`${prefix}.notes must be a string`);
      }

      if (flow.status === "pass" && !nonEmptyStrings(flow.evidence)) {
        errors.push(`${prefix}: passing flow requires at least one evidence reference`);
      }

      if (flow.status === "not_applicable") {
        if (!OPTIONAL_NOT_APPLICABLE.has(id)) {
          errors.push(`${prefix}: ${id} cannot be marked not_applicable`);
        }
        if (typeof flow.notes !== "string" || flow.notes.trim().length === 0) {
          errors.push(`${prefix}: not_applicable requires a product-scope rationale in notes`);
        }
      }

      if (flow.recoveryStatus === "pass" && !nonEmptyStrings(flow.recoveryEvidence)) {
        errors.push(`${prefix}: passing recovery requires at least one recovery evidence reference`);
      }

      if (requirePass) {
        const allowedStatus =
          flow.status === "pass" ||
          (id === "account_export" && flow.status === "not_applicable");
        if (!allowedStatus) {
          errors.push(`${prefix}: ${id} must pass before launch sign-off`);
        }

        if (RECOVERY_REQUIRED.has(id) && flow.recoveryStatus !== "pass") {
          errors.push(`${prefix}: ${id} recovery path must pass before launch sign-off`);
        }
      }
    }

    for (const id of REQUIRED_FLOW_IDS) {
      if (!seen.has(id)) errors.push(`missing required flow: ${id}`);
    }
  }

  scanForSensitiveData(manifest, "manifest", errors);
  return errors;
}

function escapeTable(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ").trim();
}

export function renderSummary(manifest: EvidenceManifest): string {
  if (!isRecord(manifest.release) || !isRecord(manifest.release.images) || !Array.isArray(manifest.flows)) {
    throw new Error("manifest must be structurally valid before rendering a summary");
  }

  const rows = manifest.flows
    .filter(isRecord)
    .map((rawFlow) => rawFlow as EvidenceFlow)
    .map((flow) => {
      const id = flow.id as (typeof REQUIRED_FLOW_IDS)[number];
      const evidence = Array.isArray(flow.evidence)
        ? flow.evidence.map((item) => escapeTable(String(item))).join("<br>")
        : "";
      const recoveryEvidence = Array.isArray(flow.recoveryEvidence)
        ? flow.recoveryEvidence.map((item) => escapeTable(String(item))).join("<br>")
        : "";
      const notes = typeof flow.notes === "string" ? escapeTable(flow.notes) : "";
      return `| ${FLOW_LABELS[id] ?? id} | ${String(flow.status)} | ${String(flow.recoveryStatus)} | ${evidence || "—"} | ${recoveryEvidence || "—"} | ${notes || "—"} |`;
    });

  const images = manifest.release.images;
  return [
    "# PR-012 real-provider validation evidence",
    "",
    `- Environment: \`${String(manifest.environment)}\``,
    `- Executed at: \`${String(manifest.executedAt)}\``,
    `- Operator: \`${escapeTable(String(manifest.operator))}\``,
    `- Commit: \`${String(manifest.release.commit)}\``,
    `- Web image: \`${String(images.web)}\``,
    `- API image: \`${String(images.api)}\``,
    `- Worker image: \`${String(images.worker)}\``,
    `- Migrator image: \`${String(images.migrator)}\``,
    "",
    "| Flow | Result | Recovery | Evidence references | Recovery references | Notes |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
    "> Generated from a schema/redaction-validated manifest. Attachments still require manual review; never attach credentials, phone numbers, email addresses, message contents, customer PII, private logs, or decrypted backup data.",
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
  const requirePass = args.includes("--require-pass");
  const summaryIndex = args.indexOf("--summary");
  const summaryPath = summaryIndex >= 0 ? args[summaryIndex + 1] : undefined;
  const evidencePath = args.find(
    (arg, index) =>
      !arg.startsWith("--") &&
      index !== summaryIndex + 1,
  );

  if (!evidencePath || (summaryIndex >= 0 && !summaryPath)) {
    console.error(
      "usage: bun infra/production/scripts/validate-provider-evidence.ts <manifest.json> [--require-pass] [--summary <output.md>]",
    );
    process.exit(2);
  }

  let manifest: EvidenceManifest;
  try {
    manifest = JSON.parse(await Bun.file(evidencePath).text()) as EvidenceManifest;
  } catch (error) {
    console.error(`failed to read/parse ${evidencePath}:`, error);
    process.exit(2);
    return;
  }

  const errors = validateManifest(manifest, { requirePass });
  if (errors.length > 0) {
    console.error("provider evidence validation failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  if (summaryPath) {
    await Bun.write(summaryPath, renderSummary(manifest));
    console.log(`validated provider evidence and wrote ${summaryPath}`);
  } else {
    console.log("provider evidence manifest is valid");
  }
}

if (import.meta.main) {
  await main();
}
