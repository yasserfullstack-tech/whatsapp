# Container and supply-chain security

This document defines the repository policy implemented by PR-021 for production container images and reproducible dependency installation.

## Scope

The production image set is:

- `whatsapp-web`
- `whatsapp-api`
- `whatsapp-worker`
- `whatsapp-migrator`

The production-infrastructure workflow builds and validates all four images on relevant pull requests and on pushes to `main`.

## Reproducible dependency installation

The repository pins Bun to `1.4.2` in CI and in the production Dockerfiles.

- Required CI/security lanes use `bun ci`, which is Bun's frozen-lockfile install mode.
- Production Dockerfiles copy the committed `bun.lock` and all workspace manifests required to validate the monorepo lockfile, then run `bun install --frozen-lockfile --ignore-scripts`.
- A dependency install must fail rather than rewrite `bun.lock` when a workspace manifest and the committed lockfile disagree.
- Do not regenerate or modify `bun.lock` merely to make CI pass. A lockfile change must correspond to an intentional dependency/workspace-manifest change or a reproduced Bun lockfile defect.

Bun documentation: https://bun.com/docs/pm/cli/install

## Container vulnerability scanning

The production-infrastructure workflow uses Trivy to scan the OS and application-library packages in every production image.

- Scanner: `aquasecurity/trivy-action` v0.36.0, pinned to commit `ed142fd0673e97e23eac54620cfb913e5ce36c25`.
- Every image gets a retained JSON report containing HIGH and CRITICAL findings, including findings that do not yet have a fix.
- Reports are uploaded as a GitHub Actions artifact for 30 days.
- A second policy scan fails the workflow when a HIGH or CRITICAL vulnerability has a fix available.
- The policy applies equally to web, API, worker, and migrator images.

Trivy action documentation: https://github.com/aquasecurity/trivy-action

## Blocking severity policy

A production image is blocked when Trivy reports a fixable vulnerability with severity `HIGH` or `CRITICAL` in an OS package or application library.

Unfixed HIGH/CRITICAL vulnerabilities are retained in the scan artifact for triage but are not automatic blockers because no patched package is available. They still require review before a production release when they are reachable or materially increase risk.

LOW and MEDIUM findings are not release blockers under this policy, but should be remediated through normal dependency/base-image maintenance.

### Exceptions

Do not suppress a fixable HIGH/CRITICAL finding silently. Any exception must be documented in the tracking issue or release PR and include:

- CVE/advisory identifier.
- Affected image/package.
- Why immediate remediation is not possible or would create greater risk.
- Reachability/exposure analysis.
- Compensating control, if any.
- Named owner.
- Expiration/review date.

An exception should be time-bounded and removed as soon as a safe fix is available.

## Image traceability

Production Dockerfiles expose OCI image labels for:

- `org.opencontainers.image.source`
- `org.opencontainers.image.revision`
- `org.opencontainers.image.version`

The production-infrastructure workflow sets source to the GitHub repository URL and revision/version to the exact Git commit SHA, tags each locally built image with that SHA, and verifies the labels before scanning and runtime smoke tests.

For a registry-backed production deployment, preserve these labels and prefer deploying an immutable image digest or a commit-SHA tag rather than a mutable tag such as `latest`.

## Evidence for PR-021

A PR-021 implementation is considered verified only when:

1. `bun ci` succeeds against the committed lockfile in CI/security lanes.
2. All production Dockerfiles complete their frozen dependency install without changing `bun.lock`.
3. The production-infrastructure workflow builds all four images and verifies OCI revision/source labels.
4. Trivy report artifacts are present for all four images.
5. The blocking HIGH/CRITICAL policy passes, or every approved exception is documented as described above.
6. Existing Bun audit, Gitleaks, CodeQL, security E2E, build, and smoke-test jobs remain green.
