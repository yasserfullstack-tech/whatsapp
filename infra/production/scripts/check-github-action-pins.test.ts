import { describe, expect, test } from "bun:test";
import { findUnpinnedActionReferences } from "./check-github-action-pins";

describe("GitHub Actions pinning policy", () => {
  test("accepts immutable external actions and local actions", () => {
    const findings = findUnpinnedActionReferences({
      ".github/workflows/test.yml": [
        "steps:",
        "  - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4",
        "  - uses: github/codeql-action/init@1c5b675653bb5c22dbe9b12b556ec555138e09fd # v4",
        "  - uses: ./.github/actions/local",
        "  - uses: docker://alpine:3.22",
      ].join("\n"),
    });
    expect(findings).toEqual([]);
  });

  test("reports mutable tags, branches, and missing revisions", () => {
    const findings = findUnpinnedActionReferences({
      ".github/workflows/test.yml": [
        "steps:",
        "  - uses: actions/checkout@v4",
        "  - uses: owner/repo/path@main",
        "  - uses: owner/repo",
      ].join("\n"),
    });

    expect(findings.map((finding) => finding.reference)).toEqual([
      "actions/checkout@v4",
      "owner/repo/path@main",
      "owner/repo",
    ]);
  });
});
