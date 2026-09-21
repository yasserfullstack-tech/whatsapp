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

## Continuous control verification

Documentation alone does not keep these controls wired, so the controls are
guarded by a check that reads the workflow files, Dockerfiles, and manifests
that implement them:

```
bun run check:container-supply-chain
```

`infra/production/scripts/check-container-supply-chain.ts` asserts that the
frozen installs, the pinned Bun toolchain, the per-image and lockfile scans, the
retained scan artifacts, the blocking policy (including `ignore-unfixed` and the
aggregating failure step), the commit-pinned scanner action, the OCI provenance
labels, and this document's severity/exception sections are all still present.
It fails, with a GitHub annotation, when one is removed or weakened.

The `Container and supply-chain controls` job in `.github/workflows/security.yml`
runs the same check on every pull request and on pushes to `main`, so the control
cannot regress silently after PR-021 is closed.

## Evidence for PR-021

A PR-021 implementation is considered verified only when:

1. `bun ci` succeeds against the committed lockfile in CI/security lanes.
2. All production Dockerfiles complete their frozen dependency install without changing `bun.lock`.
3. The production-infrastructure workflow builds all four images and verifies OCI revision/source labels.
4. Trivy report artifacts are present for all four images.
5. The blocking HIGH/CRITICAL policy passes, or every approved exception is documented as described above.
6. Existing Bun audit, Gitleaks, CodeQL, security E2E, build, and smoke-test jobs remain green.

### Verified results (issue #66)

| Claim | How it was verified | Result |
| --- | --- | --- |
| Frozen install succeeds against the committed lockfile | `bun ci` under the pinned Bun 1.4.2 in a scratch copy of the manifests and committed `bun.lock` | exit 0, `bun.lock` byte-identical afterwards |
| A plain install does not require a lockfile change for CI | `bun install` then `git diff bun.lock` | `bun ci` passes unchanged, so no lockfile edit was made |
| Scanner covers all four images and the lockfile | Trivy artifact `trivy-production-security-35525089424-1` from the [Production Infra run](https://github.com/yasserfullstack-tech/whatsapp/actions/runs/35525089424) | `trivy-web/api/worker/migrator.json` and `trivy-dependencies.json` all present |
| Blocking policy passes | Same artifact, inspecting `FixedVersion` on every HIGH/CRITICAL finding | 0 fixable HIGH/CRITICAL findings across all five reports |
| Existing security jobs stay green | [Security run on `main`](https://github.com/yasserfullstack-tech/whatsapp/actions/runs/35525718027) and [CI run on `main`](https://github.com/yasserfullstack-tech/whatsapp/actions/runs/35525718018) at `8b57bdc` | both `success` |
| Controls cannot silently regress | `bun run check:container-supply-chain` plus its regression tests | 14/14 controls pass; 18 tests cover the removal of each control |

### Accepted exceptions (issue #66)

The policy above does not block on unfixed findings, but requires them to be
reviewed. The latest production scan reports the following unfixed HIGH findings,
identical across the API, worker, and migrator images, all in the `oven/bun:1.4.2-slim`
(Debian 13.7) base image. None has a published fix, so none is a blocker; they are
retained in the scan artifact and accepted as follows.

| Field | Value |
| --- | --- |
| Advisories | `CVE-2025-69720` (ncurses), `CVE-2026-16742` (systemd), `CVE-2026-54369` (acl), `CVE-2026-76642`, `CVE-2026-78408`, `CVE-2026-78409`, `CVE-2026-78410` (util-linux), `CVE-2026-9538` (perl-Archive-Tar) |
| Affected images | `whatsapp-api`, `whatsapp-worker`, `whatsapp-migrator` |
| Affected packages | `util-linux` and its libraries, `libsystemd0`/`libudev1`, `libacl1`, `ncurses`/`libtinfo6`, `perl-base` |
| Why remediation is not immediate | Debian 13 has published no fixed package version for any of these advisories, so `ignore-unfixed` correctly does not block. Pinning a newer base is impossible until upstream releases one. |
| Reachability | `whatsapp-api` and `whatsapp-worker` run as the unprivileged `bun` user with `no-new-privileges`. The util-linux mount/`nsenter` issues require `CAP_SYS_ADMIN` and a privileged mount helper; `systemd-homed` is not present or running in these containers; the ncurses issues need an interactive terminal; `perl-Archive-Tar` is not invoked by the application. |
| Migrator exposure | `whatsapp-migrator` runs as non-root under `USER bun` in the `migrator` stage. The migration command writes schema state to PostgreSQL, not to a mounted application volume, so the runtime does not require root filesystem privileges. The `migrate` Compose service also retains `no-new-privileges: true`, the `ops` profile, one-shot execution, no published ports, and no interactive shell. |
| Compensating controls | Non-root `USER bun` for the API, worker, and migrator images; `no-new-privileges` in `docker-compose.production.yml`; immutable digest-pinned release images; and no interactive shell in the runtime path. The migrator is additionally confined to the `ops` profile and one-shot execution. |
| Owner | @yasserfullstack-tech |
| Review / expiry date | 2026-10-20 — re-check for a Debian fix, and remove this exception as soon as one ships |

No finding is suppressed from the scan reports; a `.trivyignore` is deliberately
not used, so these remain visible for triage in every artifact.

