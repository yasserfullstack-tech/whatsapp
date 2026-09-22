#!/usr/bin/env bun

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type ActionPinFinding = {
  workflow: string;
  reference: string;
  revision: string | null;
};

const ACTION_SHA = /^[0-9a-f]{40}$/i;
const USES_RE = /^\s*(?:-\s*)?uses:\s*([^\s#]+)(?:\s+#.*)?$/gm;

export function findUnpinnedActionReferences(
  workflows: Record<string, string>,
): ActionPinFinding[] {
  const findings: ActionPinFinding[] = [];

  for (const [workflow, content] of Object.entries(workflows)) {
    for (const match of content.matchAll(USES_RE)) {
      const reference = match[1] ?? "";
      if (reference.startsWith("./") || reference.startsWith("docker://")) continue;

      const separator = reference.lastIndexOf("@");
      const revision = separator > 0 ? reference.slice(separator + 1) : null;
      if (!revision || !ACTION_SHA.test(revision)) {
        findings.push({ workflow, reference, revision });
      }
    }
  }

  return findings;
}

function loadWorkflowFiles(directory = ".github/workflows"): Record<string, string> {
  return Object.fromEntries(
    readdirSync(directory)
      .filter((name) => /\.ya?ml$/i.test(name))
      .sort()
      .map((name) => [join(directory, name), readFileSync(join(directory, name), "utf8")]),
  );
}

function main(): void {
  const findings = findUnpinnedActionReferences(loadWorkflowFiles());
  if (findings.length === 0) {
    console.log("All external GitHub Actions references are pinned to 40-character commit SHAs.");
    return;
  }

  console.error("Mutable or invalid GitHub Actions references found:");
  for (const finding of findings) {
    console.error(
      `- ${finding.workflow}: ${finding.reference} (${finding.revision ?? "missing revision"})`,
    );
  }
  process.exit(1);
}

if (import.meta.main) {
  main();
}
