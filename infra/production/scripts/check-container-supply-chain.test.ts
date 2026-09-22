import { describe, expect, test } from "bun:test";
import {
	bunImagePinsAreFrozen,
	composeServiceBlock,
	composeUserOverrideRunsAsRoot,
	externalComposeImageRefs,
	imageRefUsesDigest,
	dockerInstructions,
	evaluateControls,
	frozenInstallProblems,
	parseDockerStages,
	parseSeverityList,
	POLICY_TARGETS,
	PRODUCTION_IMAGES,
	type RepoSource,
	splitWorkflowSteps,
	stageRunsAsRoot,
	stepId,
	trivyActionRefs,
} from "./check-container-supply-chain";

const PIN = "ed142fd0673e97e23eac54620cfb913e5ce36c25";
const SHA = "${{ github.sha }}";
const LABELS = [
	'LABEL org.opencontainers.image.source="$IMAGE_SOURCE" \\',
	'      org.opencontainers.image.revision="$IMAGE_REVISION" \\',
	'      org.opencontainers.image.version="$IMAGE_VERSION"',
].join("\n");

function dockerfile(): string {
	return [
		"FROM oven/bun:1.4.2-slim@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc AS build",
		"RUN bun install --frozen-lockfile --ignore-scripts",
		"FROM oven/bun:1.4.2-slim@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc AS runtime",
		LABELS,
	].join("\n");
}

/** api.Dockerfile with both `migrator` and `runtime` stages running as `bun`. */
function apiDockerfile(): string {
	return [
		"FROM oven/bun:1.4.2-slim@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc AS build",
		"RUN bun install --frozen-lockfile --ignore-scripts",
		"FROM oven/bun:1.4.2-slim@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc AS migrator",
		LABELS,
		"USER bun",
		'CMD ["bun", "run", "--filter", "@wa/db", "db:migrate:runtime"]',
		"FROM oven/bun:1.4.2-slim@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc AS runtime",
		LABELS,
		"USER bun",
	].join("\n");
}

const COMPOSE = [
	"services:",
	"  postgres:",
	"    image: postgres:17-alpine@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	"  migrate:",
	'    profiles: ["ops"]',
	"    build:",
	"      target: migrator",
	"    security_opt:",
	"      - no-new-privileges:true",
	"  web:",
	"    image: ${WEB_IMAGE:?WEB_IMAGE is required}",
].join("\n");

const MIGRATOR_ROOT_ROW =
	"| Migrator exposure | `whatsapp-migrator` runs as root: the `migrator` stage declares no `USER`. |";
const MIGRATOR_NON_ROOT_ROW =
	"| Migrator exposure | `whatsapp-migrator` runs as non-root under `USER bun`. |";

function policyDoc(migratorRow: string = MIGRATOR_NON_ROOT_ROW): string {
	return [
		"## Blocking severity policy",
		"",
		"HIGH and CRITICAL block.",
		"",
		"## Exceptions",
		"",
		migratorRow,
	].join("\n");
}

type WorkflowOptions = {
	skipEnforcementFor?: string;
	weakenSeverityFor?: string;
	dropOutcomeFor?: string;
};

function enforcementStep(name: string, id: string, options: WorkflowOptions, image?: string): string {
	const target = image ?? "dependencies";
	const severity = options.weakenSeverityFor === target ? "CRITICAL" : "HIGH,CRITICAL";
	return [
		`      - name: ${name}`,
		`        id: ${id}`,
		"        continue-on-error: true",
		`        uses: aquasecurity/trivy-action@${PIN} # v0.36.0`,
		"        with:",
		...(image
			? [`          image-ref: whatsapp-${image}:${SHA}`]
			: ["          scan-type: fs", "          scan-ref: ."]),
		'          exit-code: "1"',
		"          ignore-unfixed: true",
		`          severity: ${severity}`,
	].join("\n");
}

function productionInfraWorkflow(options: WorkflowOptions = {}): string {
	const enforcement = [
		...PRODUCTION_IMAGES.map((image) =>
			enforcementStep(`Enforce ${image} image vulnerability policy`, `policy_${image}`, options, image),
		),
		enforcementStep("Enforce production dependency vulnerability policy", "policy_dependencies", options),
	].filter((step) => !step.includes(`whatsapp-${options.skipEnforcementFor}:`));

	const aggregationRefs = ["policy_dependencies", ...PRODUCTION_IMAGES.map((image) => `policy_${image}`)]
		.filter((id) => `policy_${options.dropOutcomeFor}` !== id)
		.map((id) => `            "x:\${{ steps.${id}.outcome }}" \\`);

	return [
		"jobs:",
		"  validate:",
		"    steps:",
		"      - name: Verify image revision and source labels",
		"        run: |",
		'          docker image inspect "$ref" --format \'{{ index .Config.Labels "org.opencontainers.image.revision" }}\'',
		'          test "$source" = "org.opencontainers.image.source"',
		"      - name: Record dependency report",
		`        uses: aquasecurity/trivy-action@${PIN} # v0.36.0`,
		"        with:",
		"          scan-type: fs",
		"          scan-ref: .",
		'          exit-code: "0"',
		...PRODUCTION_IMAGES.map((image) =>
			[
				`      - name: Record ${image} image vulnerability report`,
				`        uses: aquasecurity/trivy-action@${PIN} # v0.36.0`,
				"        with:",
				`          image-ref: whatsapp-${image}:${SHA}`,
				'          exit-code: "0"',
			].join("\n"),
		),
		...enforcement,
		"      - name: Upload production vulnerability reports",
		"        uses: actions/upload-artifact@v4",
		"        with:",
		"          path: trivy-*.json",
		"          retention-days: 30",
		"      - name: Require production dependencies and images to pass the blocking vulnerability policy",
		"        shell: bash",
		"        run: |",
		"          failed=0",
		"          for result in \\",
		...aggregationRefs,
		"            ; do failed=1; done",
		'          exit "$failed"',
	].join("\n");
}

function goodSource(): RepoSource {
	return {
		ciWorkflow: "jobs:\n  checks:\n    steps:\n      - name: Install\n        run: bun ci\n",
		securityWorkflow: "jobs:\n  audit:\n    steps:\n      - name: Install\n        run: bun ci\n",
		productionInfraWorkflow: productionInfraWorkflow(),
		dockerfiles: {
			"infra/docker/web.Dockerfile": dockerfile(),
			"infra/docker/api.Dockerfile": apiDockerfile(),
			"infra/docker/worker.Dockerfile": dockerfile(),
		},
		rootPackageJson: JSON.stringify({ packageManager: "bun@1.4.2" }),
		policyDoc: policyDoc(),
		composeProduction: COMPOSE,
		caddyfile: "@internalOnly path /metrics /ready\nrespond @internalOnly 404\n@api path /api/v1/* /health",
	};
}

function resultFor(source: RepoSource, id: string): boolean {
	const check = evaluateControls(source).find((entry) => entry.id === id);
	if (!check) throw new Error(`unknown control id: ${id}`);
	return check.ok;
}

describe("check-container-supply-chain baseline", () => {
	test("all controls pass on a conforming repository layout", () => {
		const checks = evaluateControls(goodSource());
		const failing = checks.filter((check) => !check.ok);
		expect(failing.map((check) => check.id)).toEqual([]);
		expect(checks.length).toBeGreaterThanOrEqual(15);
	});
});

describe("check-container-supply-chain detects regressions", () => {
	test("flags a CI workflow that stops using the frozen lockfile", () => {
		const source = goodSource();
		source.ciWorkflow = "jobs:\n  checks:\n    steps:\n      - run: bun install\n";
		expect(resultFor(source, "frozen-install-ci")).toBe(false);
	});

	test("flags a security workflow that stops using the frozen lockfile", () => {
		const source = goodSource();
		source.securityWorkflow = "jobs:\n  audit:\n    steps:\n      - run: bun install\n";
		expect(resultFor(source, "frozen-install-security")).toBe(false);
	});

	test("flags a Dockerfile that drops --frozen-lockfile", () => {
		const source = goodSource();
		source.dockerfiles["infra/docker/worker.Dockerfile"] = dockerfile().replace(
			" --frozen-lockfile",
			"",
		);
		expect(resultFor(source, "frozen-install-images")).toBe(false);
	});

	test("flags a second unfrozen install masked by a frozen one in the same file", () => {
		const source = goodSource();
		source.dockerfiles["infra/docker/worker.Dockerfile"] = dockerfile().replace(
			"RUN bun install --frozen-lockfile --ignore-scripts",
			[
				"RUN bun install --frozen-lockfile --ignore-scripts",
				"RUN bun install --ignore-scripts",
			].join("\n"),
		);
		expect(resultFor(source, "frozen-install-images")).toBe(false);
	});

	test("flags a Dockerfile with no dependency install at all", () => {
		const source = goodSource();
		source.dockerfiles["infra/docker/worker.Dockerfile"] = [
			"FROM oven/bun:1.4.2-slim@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc AS runtime",
			LABELS,
		].join("\n");
		expect(resultFor(source, "frozen-install-images")).toBe(false);
	});

	test("rejects malformed double-digest image references", () => {
		expect(imageRefUsesDigest("postgres:17-alpine@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")).toBe(false);
		expect(imageRefUsesDigest("postgres:17-alpine@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(true);
	});

	test("flags a mutable third-party production image", () => {
		const source = goodSource();
		source.composeProduction = source.composeProduction.replace(
			"postgres:17-alpine@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			"postgres:17-alpine",
		);
		expect(resultFor(source, "third-party-image-digests")).toBe(false);
	});

	test("extracts only literal external Compose images and validates digests", () => {
		const refs = externalComposeImageRefs([
			"services:",
			"  postgres:",
			"    image: postgres:17-alpine@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			"  web:",
			"    image: ${WEB_IMAGE:?WEB_IMAGE is required}",
		].join("\n"));
		expect(refs).toHaveLength(1);
		expect(imageRefUsesDigest(refs[0]!)).toBe(true);
		expect(imageRefUsesDigest("postgres:17-alpine")).toBe(false);
	});

	test("flags a Bun base that keeps the version but drops the digest", () => {
		const source = goodSource();
		source.dockerfiles["infra/docker/web.Dockerfile"] = dockerfile().replaceAll(
			"@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
			"",
		);
		expect(resultFor(source, "bun-image-pinned")).toBe(false);
	});

	test("flags an unpinned Bun base image", () => {
		const source = goodSource();
		source.dockerfiles["infra/docker/api.Dockerfile"] = apiDockerfile().replace(
			"oven/bun:1.4.2-slim",
			"oven/bun:latest",
		);
		expect(resultFor(source, "bun-image-pinned")).toBe(false);
	});

	test("flags a root manifest that stops pinning the toolchain", () => {
		const source = goodSource();
		source.rootPackageJson = JSON.stringify({ packageManager: "bun@1.3.14" });
		expect(resultFor(source, "bun-version-pinned")).toBe(false);
	});

	test("flags a mutable image ref even when another step for the same image is pinned", () => {
		const source = goodSource();
		// Only the report step loses the revision tag; the enforcing step for the
		// same image still uses it, which the previous `.some()` predicate accepted.
		source.productionInfraWorkflow = source.productionInfraWorkflow.replace(
			`image-ref: whatsapp-migrator:${SHA}`,
			"image-ref: whatsapp-migrator:local",
		);
		expect(resultFor(source, "image-scan-coverage")).toBe(false);
	});

	test("flags a production image that has no scan at all", () => {
		const source = goodSource();
		source.productionInfraWorkflow = source.productionInfraWorkflow.replaceAll(
			`image-ref: whatsapp-migrator:${SHA}`,
			"image-ref: whatsapp-migrator:local",
		);
		source.productionInfraWorkflow = source.productionInfraWorkflow.replaceAll(
			"image-ref: whatsapp-migrator:local",
			"",
		);
		expect(resultFor(source, "image-scan-coverage")).toBe(false);
	});

	test("flags removal of the lockfile filesystem scan", () => {
		const source = goodSource();
		source.productionInfraWorkflow = source.productionInfraWorkflow.replaceAll(
			"          scan-type: fs",
			"          scan-type: image",
		);
		expect(resultFor(source, "dependency-scan")).toBe(false);
	});

	test("flags a lockfile scan that is retargeted away from the repository root", () => {
		const source = goodSource();
		source.productionInfraWorkflow = source.productionInfraWorkflow.replaceAll(
			"          scan-ref: .",
			"          scan-ref: ./apps/api",
		);
		expect(resultFor(source, "dependency-scan")).toBe(false);
	});

	test("flags removal of the retained scan-report artifact", () => {
		const source = goodSource();
		source.productionInfraWorkflow = source.productionInfraWorkflow.replace(
			"          retention-days: 30",
			"",
		);
		expect(resultFor(source, "scan-artifacts")).toBe(false);
	});

	test("flags a policy step that stops failing the build", () => {
		const source = goodSource();
		source.productionInfraWorkflow = source.productionInfraWorkflow.replace(
			'          exit-code: "1"',
			'          exit-code: "0"',
		);
		expect(resultFor(source, "blocking-policy")).toBe(false);
	});

	test("flags a policy step that stops ignoring unfixed findings", () => {
		const source = goodSource();
		source.productionInfraWorkflow = source.productionInfraWorkflow.replace(
			"          ignore-unfixed: true",
			"          ignore-unfixed: false",
		);
		expect(resultFor(source, "blocking-policy")).toBe(false);
	});

	test("flags loss of the aggregated policy failure", () => {
		const source = goodSource();
		source.productionInfraWorkflow = source.productionInfraWorkflow.replace(
			'          exit "$failed"',
			"          echo done",
		);
		expect(resultFor(source, "blocking-policy-aggregated")).toBe(false);
	});

	test("flags an unpinned scanner action", () => {
		const source = goodSource();
		source.productionInfraWorkflow = source.productionInfraWorkflow.replaceAll(
			`aquasecurity/trivy-action@${PIN}`,
			"aquasecurity/trivy-action@v0.36.0",
		);
		expect(resultFor(source, "scanner-pinned")).toBe(false);
	});

	test("flags a mutable third-party production image", () => {
		const source = goodSource();
		source.composeProduction = source.composeProduction.replace(
			/postgres:17-alpine@sha256:[0-9a-f]{64}/,
			"postgres:17-alpine",
		);
		expect(resultFor(source, "third-party-image-digests")).toBe(false);
	});

	test("flags a public dependency readiness endpoint", () => {
		const source = goodSource();
		source.caddyfile = "@api path /api/v1/* /health /ready";
		expect(resultFor(source, "readiness-private")).toBe(false);
	});

	test("flags a Dockerfile that drops a provenance label", () => {
		const source = goodSource();
		source.dockerfiles["infra/docker/web.Dockerfile"] = dockerfile().replace(
			"      org.opencontainers.image.version=\"$IMAGE_VERSION\"",
			"",
		);
		expect(resultFor(source, "provenance-labels")).toBe(false);
	});

	test("flags a workflow that stops verifying provenance labels", () => {
		const source = goodSource();
		source.productionInfraWorkflow = source.productionInfraWorkflow.replaceAll(
			"org.opencontainers.image.revision",
			"image.revision",
		);
		source.productionInfraWorkflow = source.productionInfraWorkflow.replaceAll(
			"org.opencontainers.image.source",
			"image.source",
		);
		expect(resultFor(source, "provenance-verified")).toBe(false);
	});

	test("flags an expired accepted vulnerability exception", () => {
		const source = goodSource();
		source.policyDoc = [
			policyDoc(),
			"",
			"### Accepted exceptions",
			"",
			"| Field | Value |",
			"| --- | --- |",
			"| Review / expiry date | 2000-01-01 — expired |",
		].join("\n");
		expect(resultFor(source, "accepted-exception-review-current")).toBe(false);
	});

	test("accepts an accepted vulnerability exception with a future review date", () => {
		const source = goodSource();
		source.policyDoc = [
			policyDoc(),
			"",
			"### Accepted exceptions",
			"",
			"| Field | Value |",
			"| --- | --- |",
			"| Review / expiry date | 2099-01-01 — review |",
		].join("\n");
		expect(resultFor(source, "accepted-exception-review-current")).toBe(true);
	});

	test("flags a policy doc that loses the exception requirements", () => {
		const source = goodSource();
		source.policyDoc = "## Blocking severity policy\n\nHIGH and CRITICAL block.\n";
		expect(resultFor(source, "policy-documented")).toBe(false);
	});
});

describe("strict enforcement severity (review thread 2)", () => {
	test("flags an enforcement scan weakened from HIGH,CRITICAL to CRITICAL", () => {
		const source = goodSource();
		source.productionInfraWorkflow = productionInfraWorkflow({ weakenSeverityFor: "migrator" });
		expect(resultFor(source, "blocking-policy")).toBe(false);
	});

	test("flags a weakened dependency enforcement scan", () => {
		const source = goodSource();
		source.productionInfraWorkflow = productionInfraWorkflow({ weakenSeverityFor: "dependencies" });
		expect(resultFor(source, "blocking-policy")).toBe(false);
	});

	test("flags a dropped enforcement step even though others remain", () => {
		const source = goodSource();
		source.productionInfraWorkflow = productionInfraWorkflow({ skipEnforcementFor: "migrator" });
		expect(resultFor(source, "blocking-policy")).toBe(false);
	});

	test("every image target is validated individually", () => {
		for (const image of PRODUCTION_IMAGES) {
			const source = goodSource();
			source.productionInfraWorkflow = productionInfraWorkflow({ weakenSeverityFor: image });
			expect(resultFor(source, "blocking-policy")).toBe(false);
		}
	});
});

describe("strict aggregation completeness (review thread 1)", () => {
	test("flags an image outcome dropped from the aggregation loop", () => {
		const source = goodSource();
		source.productionInfraWorkflow = productionInfraWorkflow({ dropOutcomeFor: "migrator" });
		expect(resultFor(source, "blocking-policy-aggregated")).toBe(false);
	});

	test("flags each individual image outcome being dropped", () => {
		for (const image of PRODUCTION_IMAGES) {
			const source = goodSource();
			source.productionInfraWorkflow = productionInfraWorkflow({ dropOutcomeFor: image });
			expect(resultFor(source, "blocking-policy-aggregated")).toBe(false);
		}
	});

	test("flags a dropped dependency outcome", () => {
		const source = goodSource();
		source.productionInfraWorkflow = productionInfraWorkflow({ dropOutcomeFor: "dependencies" });
		expect(resultFor(source, "blocking-policy-aggregated")).toBe(false);
	});

	test("flags an enforcing step that has no id to aggregate", () => {
		const source = goodSource();
		source.productionInfraWorkflow = source.productionInfraWorkflow.replace(
			"        id: policy_worker",
			"",
		);
		expect(resultFor(source, "blocking-policy-aggregated")).toBe(false);
	});
});

describe("strict scanner pinning (review thread 3)", () => {
	test("flags a single floating reference while others stay pinned", () => {
		const source = goodSource();
		// Only the first invocation loses its pin; the remaining ones are still
		// SHA-pinned, which is exactly what the old predicate accepted.
		source.productionInfraWorkflow = source.productionInfraWorkflow.replace(
			`aquasecurity/trivy-action@${PIN}`,
			"aquasecurity/trivy-action@v0.36.0",
		);
		expect(resultFor(source, "scanner-pinned")).toBe(false);
		expect(trivyActionRefs(source.productionInfraWorkflow)).toContain("v0.36.0");
	});

	test("flags a floating reference in a late enforcement step", () => {
		const source = goodSource();
		source.productionInfraWorkflow = source.productionInfraWorkflow.replace(
			`      - name: Enforce migrator image vulnerability policy\n        id: policy_migrator\n        continue-on-error: true\n        uses: aquasecurity/trivy-action@${PIN}`,
			"      - name: Enforce migrator image vulnerability policy\n        id: policy_migrator\n        continue-on-error: true\n        uses: aquasecurity/trivy-action@v0.36.0",
		);
		expect(resultFor(source, "scanner-pinned")).toBe(false);
	});
});

describe("migrator exposure documentation (review thread 4)", () => {
	test("flags a root migrator that the doc claims is non-root", () => {
		const source = goodSource();
		source.dockerfiles["infra/docker/api.Dockerfile"] = apiDockerfile().replace(
			'USER bun\nCMD ["bun", "run", "--filter", "@wa/db", "db:migrate:runtime"]',
			'CMD ["bun", "run", "--filter", "@wa/db", "db:migrate:runtime"]',
		);
		expect(resultFor(source, "migrator-exposure-documented")).toBe(false);
	});

	test("flags a policy doc that omits migrator exposure entirely", () => {
		const source = goodSource();
		source.policyDoc = policyDoc("| Owner | @yasserfullstack-tech |");
		expect(resultFor(source, "migrator-exposure-documented")).toBe(false);
	});

	test("flags a non-root migrator that the doc still calls root", () => {
		const source = goodSource();
		source.policyDoc = policyDoc(MIGRATOR_ROOT_ROW);
		expect(resultFor(source, "migrator-exposure-documented")).toBe(false);
	});

	test("accepts a non-root migrator once the doc says so", () => {
		const source = goodSource();
		expect(resultFor(source, "migrator-exposure-documented")).toBe(true);
	});

	test("treats an explicit non-root compose user override as non-root", () => {
		const source = goodSource();
		source.dockerfiles["infra/docker/api.Dockerfile"] = apiDockerfile().replace(
			'USER bun\nCMD ["bun", "run", "--filter", "@wa/db", "db:migrate:runtime"]',
			'CMD ["bun", "run", "--filter", "@wa/db", "db:migrate:runtime"]',
		);
		source.composeProduction = COMPOSE.replace(
			'    profiles: ["ops"]',
			'    profiles: ["ops"]\n    user: "1001:1001"',
		);
		expect(resultFor(source, "migrator-exposure-documented")).toBe(true);
	});

	test("does not let a root compose override masquerade as non-root", () => {
		const source = goodSource();
		source.composeProduction = COMPOSE.replace(
			'    profiles: ["ops"]',
			'    profiles: ["ops"]\n    user: "0:0"',
		);
		expect(resultFor(source, "migrator-exposure-documented")).toBe(false);
	});

	test("treats variable compose user overrides as unsafe", () => {
		const source = goodSource();
		source.composeProduction = COMPOSE.replace(
			'    profiles: ["ops"]',
			'    profiles: ["ops"]\n    user: "${MIGRATOR_USER}"',
		);
		expect(resultFor(source, "migrator-exposure-documented")).toBe(false);
	});
});

describe("check-container-supply-chain helpers", () => {
	test("splitWorkflowSteps returns one entry per named step", () => {
		const steps = splitWorkflowSteps(
			[
				"jobs:",
				"  j:",
				"    steps:",
				"      - name: one",
				"        run: a",
				"      - name: two",
				"        run: b",
			].join("\n"),
		);
		expect(steps.map((step) => step.name)).toEqual(["one", "two"]);
		expect(steps[0].body).toContain("run: a");
		expect(steps[1].body).toContain("run: b");
	});

	test("stepId reads the id of a step", () => {
		const steps = splitWorkflowSteps("      - name: a\n        id: policy_x\n        run: b");
		expect(stepId(steps[0])).toBe("policy_x");
	});

	test("bunImagePinsAreFrozen rejects floating, unpinned, and wrong-version tags", () => {
		const digest = "a".repeat(64);
		expect(bunImagePinsAreFrozen(`FROM oven/bun:1.4.2-alpine@sha256:${digest}\n`).ok).toBe(true);
		expect(bunImagePinsAreFrozen("FROM oven/bun:1.4.2-alpine\n").ok).toBe(false);
		expect(bunImagePinsAreFrozen("FROM oven/bun:latest\n").ok).toBe(false);
		expect(bunImagePinsAreFrozen(`FROM oven/bun:1.3.14-alpine@sha256:${digest}\n`).ok).toBe(false);
		expect(bunImagePinsAreFrozen("FROM node:22-alpine\n").ok).toBe(false);
	});

	test("parseSeverityList normalises the severity list", () => {
		expect(parseSeverityList("          severity: HIGH,CRITICAL\n")).toEqual(["HIGH", "CRITICAL"]);
		expect(parseSeverityList("          severity: critical\n")).toEqual(["CRITICAL"]);
		expect(parseSeverityList("          exit-code: \"1\"\n")).toBeUndefined();
	});

	test("trivyActionRefs enumerates every reference", () => {
		const content = [
			"uses: aquasecurity/trivy-action@aaaa",
			"uses: aquasecurity/trivy-action@bbbb # v1",
		].join("\n");
		expect(trivyActionRefs(content)).toEqual(["aaaa", "bbbb"]);
	});

	test("parseDockerStages and stageRunsAsRoot read per-stage privileges", () => {
		const stages = parseDockerStages(apiDockerfile());
		expect(stages.map((stage) => stage.name)).toEqual(["build", "migrator", "runtime"]);
		const migrator = stages.find((stage) => stage.name === "migrator");
		const runtime = stages.find((stage) => stage.name === "runtime");
		expect(migrator && stageRunsAsRoot(migrator.body)).toBe(false);
		expect(runtime && stageRunsAsRoot(runtime.body)).toBe(false);
	});

	test("composeServiceBlock isolates a service and stops at the next key", () => {
		const block = composeServiceBlock(COMPOSE, "migrate");
		expect(block).toContain("no-new-privileges:true");
		expect(block).not.toContain("postgres:17-alpine");
		expect(block).not.toContain("image: example");
		expect(composeServiceBlock(COMPOSE, "missing")).toBeUndefined();
	});

	test("composeUserOverrideRunsAsRoot distinguishes root, non-root, and absent overrides", () => {
		expect(composeUserOverrideRunsAsRoot("    user: \"0:0\"")).toBe(true);
		expect(composeUserOverrideRunsAsRoot("    user: root")).toBe(true);
		expect(composeUserOverrideRunsAsRoot("    user: \"1001:1001\"")).toBe(false);
		expect(composeUserOverrideRunsAsRoot("    user: bun")).toBe(false);
		expect(composeUserOverrideRunsAsRoot("    user: \"${MIGRATOR_USER}\"")).toBe(true);
		expect(composeUserOverrideRunsAsRoot("    image: example")).toBeUndefined();
	});

	test("POLICY_TARGETS covers dependencies plus every production image", () => {
		expect(POLICY_TARGETS.map((target) => target.key)).toEqual([
			"dependencies",
			...PRODUCTION_IMAGES,
		]);
	});

	test("dockerInstructions joins backslash continuations and handles CRLF", () => {
		const content = ["RUN bun install \\", "    --frozen-lockfile \\", "    --ignore-scripts", "USER bun"].join(
			"\r\n",
		);
		const instructions = dockerInstructions(content);
		expect(instructions).toHaveLength(2);
		expect(instructions[0]).toContain("--frozen-lockfile");
		expect(instructions[1]).toBe("USER bun");
	});

	test("frozenInstallProblems reports only the unfrozen invocations", () => {
		const content = [
			"RUN bun install --frozen-lockfile --ignore-scripts",
			"RUN bun install --production --frozen-lockfile --filter @wa/db",
			"RUN bun install --ignore-scripts",
		].join("\n");
		expect(frozenInstallProblems(content)).toEqual(["RUN bun install --ignore-scripts"]);
		expect(
			frozenInstallProblems("RUN bun install --frozen-lockfile --ignore-scripts"),
		).toEqual([]);
	});
});
