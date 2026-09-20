#!/usr/bin/env bun

/**
 * PR-021 (issue #66) container and supply-chain control guard.
 *
 * The repository documents its container/supply-chain controls in
 * `docs/container-supply-chain-security.md`, but documentation alone does not
 * keep them wired. This check reads the workflow files, Dockerfiles, and
 * manifest that actually implement the controls and fails when one is removed
 * or weakened, so the control stays continuous after PR-021 is verified.
 *
 * It is a pure file-content check: it does not build images, install
 * dependencies, or call the network, so it is safe to run on every pull
 * request.
 */

import { readFileSync } from "node:fs";

export type ControlCheck = {
	id: string;
	description: string;
	ok: boolean;
	detail: string;
};

export type RepoSource = {
	ciWorkflow: string;
	securityWorkflow: string;
	productionInfraWorkflow: string;
	dockerfiles: Record<string, string>;
	rootPackageJson: string;
	policyDoc: string;
};

/** Production images that must be scanned and labelled. */
export const PRODUCTION_IMAGES = ["web", "api", "worker", "migrator"] as const;

/** Bun version the repository pins for CI and image builds. */
export const PINNED_BUN_VERSION = "1.4.2";

const OCI_LABELS = [
	"org.opencontainers.image.source",
	"org.opencontainers.image.revision",
	"org.opencontainers.image.version",
] as const;

export type WorkflowStep = { name: string; body: string };

/**
 * Splits a workflow file into its `- name:` steps. Regex parsing keeps this
 * dependency-free and tolerant of the surrounding YAML.
 */
export function splitWorkflowSteps(workflow: string): WorkflowStep[] {
	const steps: WorkflowStep[] = [];
	let current: { name: string; body: string[] } | null = null;
	for (const line of workflow.split("\n")) {
		const match = line.match(/^\s*- name:\s*(.+?)\s*$/);
		if (match) {
			if (current) steps.push({ name: current.name, body: current.body.join("\n") });
			current = { name: match[1], body: [line] };
			continue;
		}
		if (current) current.body.push(line);
	}
	if (current) steps.push({ name: current.name, body: current.body.join("\n") });
	return steps;
}

/** True when the file pins the pinned Bun image for every `FROM oven/bun` stage. */
export function bunImagePinsAreFrozen(content: string): { ok: boolean; detail: string } {
	const refs = [...content.matchAll(/^FROM\s+oven\/bun:(\S+)/gim)].map((match) => match[1]);
	if (refs.length === 0) {
		return { ok: false, detail: "no `FROM oven/bun:<version>` stage found" };
	}
	const unpinned = refs.filter((ref) => !ref.startsWith(`${PINNED_BUN_VERSION}-`));
	if (unpinned.length > 0) {
		return {
			ok: false,
			detail: `unpinned or unexpected Bun image tag(s): ${unpinned.join(", ")}`,
		};
	}
	return { ok: true, detail: `all ${refs.length} Bun stage(s) pinned to ${PINNED_BUN_VERSION}` };
}

/**
 * Evaluates every PR-021 control against the supplied sources.
 * Pure: all inputs are file contents, so it is directly unit-testable.
 */
export function evaluateControls(source: RepoSource): ControlCheck[] {
	const checks: ControlCheck[] = [];

	const push = (
		id: string,
		description: string,
		ok: boolean,
		detail: string,
	): void => {
		checks.push({ id, description, ok, detail });
	};

	// --- Reproducible / frozen dependency installation ---------------------

	const ciUsesFrozen = /^\s*run:\s*bun ci\s*$/m.test(source.ciWorkflow);
	push(
		"frozen-install-ci",
		"CI installs dependencies with the frozen lockfile (`bun ci`)",
		ciUsesFrozen,
		ciUsesFrozen ? "ci.yml runs `bun ci`" : "ci.yml no longer runs `bun ci`",
	);

	const securityUsesFrozen = /^\s*run:\s*bun ci\s*$/m.test(source.securityWorkflow);
	push(
		"frozen-install-security",
		"Security workflow installs dependencies with the frozen lockfile (`bun ci`)",
		securityUsesFrozen,
		securityUsesFrozen ? "security.yml runs `bun ci`" : "security.yml no longer runs `bun ci`",
	);

	const unpinnedInstalls: string[] = [];
	for (const [name, content] of Object.entries(source.dockerfiles)) {
		if (!content.includes("--frozen-lockfile")) unpinnedInstalls.push(name);
	}
	push(
		"frozen-install-images",
		"Every production image installs with `--frozen-lockfile`",
		unpinnedInstalls.length === 0,
		unpinnedInstalls.length === 0
			? `all ${Object.keys(source.dockerfiles).length} Dockerfile(s) use --frozen-lockfile`
			: `missing --frozen-lockfile: ${unpinnedInstalls.join(", ")}`,
	);

	let packageManager: string | undefined;
	try {
		packageManager = (JSON.parse(source.rootPackageJson) as { packageManager?: string })
			.packageManager;
	} catch {
		packageManager = undefined;
	}
	push(
		"bun-version-pinned",
		`Root manifest pins the toolchain to bun@${PINNED_BUN_VERSION}`,
		packageManager === `bun@${PINNED_BUN_VERSION}`,
		packageManager === `bun@${PINNED_BUN_VERSION}`
			? `package.json declares packageManager ${packageManager}`
			: `package.json packageManager is ${packageManager ?? "(absent)"}`,
	);

	const bunPinProblems: string[] = [];
	for (const [name, content] of Object.entries(source.dockerfiles)) {
		const result = bunImagePinsAreFrozen(content);
		if (!result.ok) bunPinProblems.push(`${name}: ${result.detail}`);
	}
	push(
		"bun-image-pinned",
		`Every Bun base image is pinned to ${PINNED_BUN_VERSION}`,
		bunPinProblems.length === 0,
		bunPinProblems.length === 0
			? "all Bun base images pinned"
			: bunPinProblems.join("; "),
	);

	// --- Container vulnerability scanning ----------------------------------

	const infraSteps = splitWorkflowSteps(source.productionInfraWorkflow);

	// Scans must target the commit-SHA-tagged image so the scanned artifact is
	// traceable to the exact revision, not a mutable `:local` tag.
	const shaRef = "${{ github.sha }}";
	const scannedImages = PRODUCTION_IMAGES.filter((image) =>
		infraSteps.some((step) =>
			step.body.includes(`image-ref: whatsapp-${image}:${shaRef}`),
		),
	);
	const missingImages = PRODUCTION_IMAGES.filter((image) => !scannedImages.includes(image));
	push(
		"image-scan-coverage",
		"Every production image is vulnerability-scanned at its revision tag",
		missingImages.length === 0,
		missingImages.length === 0
			? `scanned at the revision tag: ${scannedImages.join(", ")}`
			: `not scanned at the revision tag: ${missingImages.join(", ")}`,
	);

	const scansLockfile = infraSteps.some(
		(step) => /scan-type:\s*fs/.test(step.body) && /scan-ref:\s*\./.test(step.body),
	);
	push(
		"dependency-scan",
		"Application dependencies (bun.lock) are scanned",
		scansLockfile,
		scansLockfile
			? "filesystem scan covers the committed lockfile"
			: "no filesystem scan of the lockfile found",
	);

	const reportUpload = /actions\/upload-artifact@/.test(source.productionInfraWorkflow);
	const reportRetention = /retention-days:\s*\d+/.test(source.productionInfraWorkflow);
	const reportPattern = /path:\s*trivy-\*\.json/.test(source.productionInfraWorkflow);
	push(
		"scan-artifacts",
		"Scan reports are uploaded as retained artifacts",
		reportUpload && reportRetention && reportPattern,
		reportUpload && reportRetention && reportPattern
			? "trivy-*.json uploaded as an artifact with retention"
			: "scan report artifact upload is missing or no longer retains reports",
	);

	// --- Blocking severity policy ------------------------------------------

	const enforcementSteps = infraSteps.filter((step) =>
		/enforce|policy/i.test(step.name) && /exit-code:\s*"1"/.test(step.body),
	);
	const enforcementWithoutIgnoreUnfixed = enforcementSteps.filter(
		(step) => !/ignore-unfixed:\s*true/.test(step.body),
	);
	const policyCoversAllTargets = enforcementSteps.length >= PRODUCTION_IMAGES.length + 1;
	push(
		"blocking-policy",
		"Fixable HIGH/CRITICAL findings block the workflow for images and dependencies",
		enforcementSteps.length > 0 &&
			enforcementWithoutIgnoreUnfixed.length === 0 &&
			policyCoversAllTargets,
		enforcementSteps.length === 0
			? "no enforcing (exit-code 1) policy step found"
			: `enforcing steps: ${enforcementSteps.length}, without ignore-unfixed: ${enforcementWithoutIgnoreUnfixed.length}`,
	);

	const aggregationStep = infraSteps.find((step) =>
		/\.outcome/.test(step.body) && /exit\s+"?\$failed"?/.test(step.body),
	);
	push(
		"blocking-policy-aggregated",
		"Policy outcomes are aggregated into a failing job step",
		Boolean(aggregationStep),
		aggregationStep
			? `aggregated by step "${aggregationStep.name}"`
			: "no step aggregates the policy outcomes into a failure",
	);

	const pinnedScanner = /aquasecurity\/trivy-action@[0-9a-f]{40}/.test(
		source.productionInfraWorkflow,
	);
	push(
		"scanner-pinned",
		"The vulnerability scanner action is pinned to a commit SHA",
		pinnedScanner,
		pinnedScanner
			? "trivy-action pinned to a 40-character commit SHA"
			: "trivy-action is not pinned to a commit SHA",
	);

	// --- Image provenance / traceability -----------------------------------

	const labelProblems: string[] = [];
	for (const [name, content] of Object.entries(source.dockerfiles)) {
		const missing = OCI_LABELS.filter((label) => !content.includes(label));
		if (missing.length > 0) labelProblems.push(`${name}: ${missing.join(", ")}`);
	}
	push(
		"provenance-labels",
		"Every production image declares OCI source/revision/version labels",
		labelProblems.length === 0,
		labelProblems.length === 0
			? "all OCI provenance labels declared"
			: `missing labels -> ${labelProblems.join("; ")}`,
	);

	const verifiesLabels =
		/org\.opencontainers\.image\.revision/.test(source.productionInfraWorkflow) &&
		/org\.opencontainers\.image\.source/.test(source.productionInfraWorkflow);
	push(
		"provenance-verified",
		"The workflow verifies image revision/source labels before scanning",
		verifiesLabels,
		verifiesLabels
			? "workflow inspects and asserts OCI labels"
			: "workflow no longer verifies OCI labels",
	);

	// --- Policy documentation ----------------------------------------------

	const documentsSeverity = /HIGH/.test(source.policyDoc) && /CRITICAL/.test(source.policyDoc);
	const documentsExceptions = /## Exceptions/.test(source.policyDoc);
	push(
		"policy-documented",
		"The blocking severity policy and exception requirements are documented",
		documentsSeverity && documentsExceptions,
		documentsSeverity && documentsExceptions
			? "severity policy and exception requirements documented"
			: "severity policy or exception requirements are missing from the policy doc",
	);

	return checks;
}

export function renderReport(checks: ControlCheck[]): string {
	const failed = checks.filter((check) => !check.ok);
	const lines = [
		"| Control | Result | Detail |",
		"| --- | --- | --- |",
		...checks.map(
			(check) => `| ${check.id} | ${check.ok ? "PASS" : "FAIL"} | ${check.detail} |`,
		),
		"",
		`**Summary:** ${checks.length} control(s) checked, ${failed.length} failing.`,
	];
	if (failed.length > 0) {
		lines.push("", "Failing controls:");
		for (const check of failed) {
			lines.push(`- ${check.id} (${check.description}): ${check.detail}`);
		}
	}
	return lines.join("\n");
}

function loadSource(): RepoSource {
	const dockerfiles: Record<string, string> = {};
	for (const name of ["web", "api", "worker"]) {
		dockerfiles[`infra/docker/${name}.Dockerfile`] = readFileSync(
			`infra/docker/${name}.Dockerfile`,
			"utf8",
		);
	}
	return {
		ciWorkflow: readFileSync(".github/workflows/ci.yml", "utf8"),
		securityWorkflow: readFileSync(".github/workflows/security.yml", "utf8"),
		productionInfraWorkflow: readFileSync(
			".github/workflows/production-infra.yml",
			"utf8",
		),
		dockerfiles,
		rootPackageJson: readFileSync("package.json", "utf8"),
		policyDoc: readFileSync("docs/container-supply-chain-security.md", "utf8"),
	};
}

function main(): void {
	let source: RepoSource;
	try {
		source = loadSource();
	} catch (error) {
		console.error("failed to read container/supply-chain sources:", error);
		process.exit(2);
	}

	const checks = evaluateControls(source);
	console.log(renderReport(checks));

	if (process.env.GITHUB_ACTIONS === "true") {
		for (const check of checks) {
			if (check.ok) continue;
			console.log(
				`::error title=container-supply-chain::${check.id}: ${check.description} — ${check.detail}`,
			);
		}
	}

	if (checks.some((check) => !check.ok)) {
		console.error(
			"\nContainer/supply-chain controls regressed. Restore the control or update " +
				"docs/container-supply-chain-security.md and this guard together.",
		);
		process.exit(1);
	}
}

if (import.meta.main) {
	main();
}
