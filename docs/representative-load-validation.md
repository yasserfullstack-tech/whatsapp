# Representative load validation

This runbook is the PR-013 evidence layer on top of `docs/stress-soak.md`. It does not replace the load harness and it does not relax its Meta safety boundary: all benchmark sends still terminate at the local fake Graph API.

## What counts as representative

A generic GitHub-hosted runner or an arbitrary self-hosted machine is a regression environment, not representative evidence.

Select `evidence_level=representative` only when the `[self-hosted, linux, x64, stress]` runner is intentionally sized to the deployment being evaluated and its CPU, memory, storage/IOPS class, PostgreSQL/Valkey topology, and worker topology are the configuration you want to make an application-capacity statement about.

Representative evidence is scoped to the recorded configuration. It does not establish Meta/WhatsApp end-to-end delivery throughput because provider sends remain fake by design.

## Prerequisite: immutable release manifest

PR-013 reuses the safe manifest created by the PR-009 production-infrastructure tooling:

```bash
sh infra/production/scripts/write-release-manifest.sh /path/to/staging.env /srv/whatsapp/evidence/release.env
```

The manifest must contain only:

```text
RELEASE_SHA=<40-character commit SHA>
WEB_IMAGE=<registry/repository@sha256:...>
API_IMAGE=<registry/repository@sha256:...>
WORKER_IMAGE=<registry/repository@sha256:...>
MIGRATOR_IMAGE=<registry/repository@sha256:...>
```

For a representative run, `RELEASE_SHA` must exactly match the checked-out GitHub Actions SHA and every image must be pinned by an `@sha256:` digest. The workflow fails closed when either condition is false.

Keep the manifest on the dedicated runner or another operator-controlled path. Do not commit environment files or credentials.

## Running the workflow

Dispatch `.github/workflows/stress-soak.yml` manually.

For normal regression benchmarking, leave `evidence_level=regression`.

For representative evidence, set:

- `evidence_level=representative`
- `representative_environment=staging` or `production-like`
- `release_manifest_path` to the PR-009 manifest path on the runner
- `storage_profile` to the real storage/media and IOPS class
- `worker_count` and `worker_concurrency` to the expected primary campaign topology
- `capacity_claim=none`, `100k`, or `500k`

The worker inputs are assertions, not a way to rewrite the benchmark after it runs. The evidence collector derives the primary campaign worker count/concurrency from the actual benchmark artifacts and records those measured values. For `100k` or `500k` capacity evidence, a mismatch between the declared and benchmarked topology makes the evidence gate fail. Multi-worker chaos topology is recorded separately in its own report.

Use the ordinary modes when validating one failure class. Use `mode=certify` for a complete PR-013 evidence bundle. `certify` executes the full progressive stress profile, all 429/500/mixed recovery cases, all Valkey/worker/Postgres/multi-worker chaos cases, the requested soak, and duplicate/out-of-order webhook validation.

A requested `500k` application-side claim is rejected unless `mode=certify` succeeds. A requested `100k` claim requires `full` or `certify`.

## Evidence bundle

After the selected benchmark, the workflow starts the isolated load topology long enough to collect configuration and runs:

```bash
sh infra/production/scripts/collect-representative-load-evidence.sh \
  <mode> \
  <release-manifest> \
  load-results/representative-evidence
```

The collector fails closed unless the release SHA matches the benchmark SHA, release images are immutable, required report classes exist, and the benchmark step succeeded. Capacity evidence also fails closed if the declared primary worker topology differs from the topology derived from the actual benchmark report.

The uploaded `stress-soak-<run>-<attempt>` artifact contains:

- existing JSON/Markdown load reports with correctness and resource thresholds;
- `representative-evidence/representative-load-evidence.md`;
- `representative-evidence/representative-load-evidence.json`;
- `representative-evidence/report-sha256.txt`.

The evidence summary records the workflow URL, exact code/release SHA, immutable web/API/worker/migrator image digests, kernel/architecture, CPU model/count, memory, filesystem and storage profile, PostgreSQL runtime image/version/settings, Valkey runtime image/version/persistence/memory policy, benchmark-derived worker topology, the operator declaration/match result, and SHA-256 hashes of the load compose files and threshold definitions.

The report checksum file makes the bundle tamper-evident after download and uses artifact-root-relative paths. Verify it from the downloaded artifact root:

```bash
sha256sum --check representative-evidence/report-sha256.txt
```

## Metrics and pass criteria

The underlying benchmark reports remain the source of truth for measurements and thresholds. Together they cover:

- throughput/MPS, snapshot time, first-message latency, queue depth and drain time;
- worker CPU/RSS/event-loop behavior and configured concurrency;
- PostgreSQL connections and write rate;
- Valkey memory;
- retry volume, failures, duplicate-success protection, and recovery time;
- webhook ingest rate, API latency, processing/drain behavior, durable inbox state, and dead letters;
- soak growth thresholds and chaos/restart recovery.

A representative evidence bundle is not a substitute for reading the individual threshold results. A workflow failure means the run cannot support a capacity statement.

## Capacity-claim boundary

Do not publish “supports 500k” from local, GitHub-hosted, or otherwise unqualified fake-only results.

A successful `certify` artifact can support an **application-side** statement only when the recorded self-hosted environment is genuinely representative of the intended deployment. State the workload, machine/database/cache/worker configuration, threshold set, and that the Meta provider was simulated. Meta rate limits, network behavior, and end-to-end delivery performance require separate real-provider production validation.
