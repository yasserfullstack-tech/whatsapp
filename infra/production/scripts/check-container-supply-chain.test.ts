import { describe, expect, test } from "bun:test";
import {
	bunImagePinsAreFrozen,
	evaluateControls,
	PRODUCTION_IMAGES,
	type RepoSource,
	splitWorkflowSteps,
} from "./check-container-supply-chain";

const PIN = "ed142fd0673e97e23eac54620cfb913e5ce36c25";
const LABELS = [
	'LABEL org.opencontainers.image.source="$IMAGE_SOURCE" \\',
	'      org.opencontainers.image.revision="$IMAGE_REVISION" \\',
	'      org.opencontainers.image.version="$IMAGE_VERSION"',
].join("\n");

function dockerfile(): string {
	return [
		"FROM oven/bun:1.4.2-slim AS build",
		"RUN bun install --frozen-lockfile --ignore-scripts",
		"FROM oven/bun:1.4.2-slim AS runtime",
		LABELS,
	].join("\n");
}

function enforcementStep(name: string, image?: string): string {
	return [
		`      - name: ${name}`,
		"        id: policy_x",
		"        continue-on-error: true",
		`        uses: aquasecurity/trivy-action@${PIN} # v0.36.0`,
		"        with:",
		...(image ? [`          image-ref: whatsapp-${image}:\${{ github.sha }}`] : ["          scan-type: fs"]),
		"          exit-code: \"1\"",
		"          ignore-unfixed: true",
		"          severity: HIGH,CRITICAL",
	].join("\n");
}

function productionInfraWorkflow(): string {
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
		"          exit-code: \"0\"",
		...PRODUCTION_IMAGES.map((image) => enforcementStep(`Enforce ${image} image vulnerability policy`, image)),
		enforcementStep("Enforce production dependency vulnerability policy"),
		"      - name: Upload production vulnerability reports",
		"        uses: actions/upload-artifact@v4",
		"        with:",
		"          path: trivy-*.json",
		"          retention-days: 30",
		"      - name: Require production dependencies and images to pass the blocking vulnerability policy",
		"        shell: bash",
		"        run: |",
		"          failed=0",
		'          for result in "web:${{ steps.policy_x.outcome }}"; do failed=1; done',
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
			"infra/docker/api.Dockerfile": dockerfile(),
			"infra/docker/worker.Dockerfile": dockerfile(),
		},
		rootPackageJson: JSON.stringify({ packageManager: "bun@1.4.2" }),
		policyDoc: "## Blocking severity policy\n\nHIGH and CRITICAL block.\n\n## Exceptions\n\nDocument them.\n",
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
		expect(checks.length).toBeGreaterThanOrEqual(14);
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

	test("flags an unpinned Bun base image", () => {
		const source = goodSource();
		source.dockerfiles["infra/docker/api.Dockerfile"] = dockerfile().replace(
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

	test("flags a production image that is no longer scanned", () => {
		const source = goodSource();
		source.productionInfraWorkflow = source.productionInfraWorkflow.replace(
			"image-ref: whatsapp-migrator:${{ github.sha }}",
			"image-ref: whatsapp-migrator:local",
		);
		expect(resultFor(source, "image-scan-coverage")).toBe(false);
	});

	test("flags removal of the lockfile filesystem scan", () => {
		const source = goodSource();
		source.productionInfraWorkflow = source.productionInfraWorkflow.replace(
			"          scan-type: fs",
			"          scan-type: image",
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

	test("flags a policy doc that loses the exception requirements", () => {
		const source = goodSource();
		source.policyDoc = "## Blocking severity policy\n\nHIGH and CRITICAL block.\n";
		expect(resultFor(source, "policy-documented")).toBe(false);
	});
});

describe("check-container-supply-chain helpers", () => {
	test("splitWorkflowSteps returns one entry per named step", () => {
		const steps = splitWorkflowSteps(
			["jobs:", "  j:", "    steps:", "      - name: one", "        run: a", "      - name: two", "        run: b"].join(
				"\n",
			),
		);
		expect(steps.map((step) => step.name)).toEqual(["one", "two"]);
		expect(steps[0].body).toContain("run: a");
		expect(steps[1].body).toContain("run: b");
	});

	test("bunImagePinsAreFrozen rejects floating and wrong-version tags", () => {
		expect(bunImagePinsAreFrozen("FROM oven/bun:1.4.2-slim\n").ok).toBe(true);
		expect(bunImagePinsAreFrozen("FROM oven/bun:latest\n").ok).toBe(false);
		expect(bunImagePinsAreFrozen("FROM oven/bun:1.3.14-slim\n").ok).toBe(false);
		expect(bunImagePinsAreFrozen("FROM node:22-alpine\n").ok).toBe(false);
	});
});
