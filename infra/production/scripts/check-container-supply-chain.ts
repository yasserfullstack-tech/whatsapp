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
	composeProduction: string;
};

/** Production images that must be scanned and labelled. */
export const PRODUCTION_IMAGES = ["web", "api", "worker", "migrator"] as const;

/** Bun version the repository pins for CI and image builds. */
export const PINNED_BUN_VERSION = "1.4.2";

/** Severity classes that must block a release. */
export const BLOCKING_SEVERITIES = ["HIGH", "CRITICAL"] as const;

/**
 * Every target that needs its own enforcing scan. Each one must have a
 * dedicated policy step whose outcome is aggregated into the job result.
 */
export type PolicyTarget = {
	key: string;
	kind: "dependencies" | "image";
	image?: string;
};

export const POLICY_TARGETS: PolicyTarget[] = [
	{ key: "dependencies", kind: "dependencies" },
	...PRODUCTION_IMAGES.map((image) => ({ key: image, kind: "image" as const, image })),
];

const OCI_LABELS = [
	"org.opencontainers.image.source",
	"org.opencontainers.image.revision",
	"org.opencontainers.image.version",
] as const;

/** Matches a scan pinned to the repository root, not a sub-path. */
const ROOT_SCAN_REF_RE = /^\s*scan-ref:\s*\.\s*$/m;

/** Matches a filesystem scan step targeting the repository root. */
function isLockfileScan(body: string): boolean {
	return /scan-type:\s*fs/.test(body) && ROOT_SCAN_REF_RE.test(body);
}

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

/** Splits a Dockerfile into logical instructions, joining `\` continuations. */
export function dockerInstructions(content: string): string[] {
	const instructions: string[] = [];
	let buffer = "";
	for (const raw of content.split("\n")) {
		const line = raw.replace(/\r$/, "");
		buffer = buffer ? `${buffer} ${line.trim()}` : line;
		if (/\\\s*$/.test(buffer)) continue;
		instructions.push(buffer);
		buffer = "";
	}
	if (buffer) instructions.push(buffer);
	return instructions;
}

/**
 * Returns every `bun install` invocation that does not freeze the lockfile.
 * Every invocation must be checked: one frozen install must not mask a second
 * unfrozen one in the same Dockerfile.
 */
export function frozenInstallProblems(content: string): string[] {
	return dockerInstructions(content)
		.filter((instruction) => /\bbun\s+install\b/.test(instruction))
		.filter((instruction) => !instruction.includes("--frozen-lockfile"))
		.map((instruction) => instruction.trim());
}

/** Splits a Dockerfile into its `FROM ... AS <name>` build stages. */
export function parseDockerStages(content: string): Array<{ name: string; body: string }> {
	const stages: Array<{ name: string; body: string[] }> = [];
	let current: { name: string; body: string[] } | null = null;
	for (const line of content.split("\n")) {
		const match = line.match(/^FROM\s+\S+(?:\s+AS\s+(\S+))?\s*$/i);
		if (match) {
			if (current) stages.push(current);
			current = { name: match[1] ?? `stage-${stages.length}`, body: [line] };
			continue;
		}
		if (current) current.body.push(line);
	}
	if (current) stages.push(current);
	return stages.map((stage) => ({ name: stage.name, body: stage.body.join("\n") }));
}

/** True when a Docker stage never drops privileges with a `USER` instruction. */
export function stageRunsAsRoot(stage: string): boolean {
	return !/^\s*USER\s+\S/m.test(stage);
}

/** Returns the body of a top-level service block in a Compose file. */
export function composeServiceBlock(content: string, name: string): string | undefined {
	const lines = content.split("\n");
	const start = lines.findIndex((line) => new RegExp(`^\\s{2}${name}:\\s*$`).test(line));
	if (start === -1) return undefined;
	const body: string[] = [];
	for (let index = start + 1; index < lines.length; index++) {
		// A service key (2 spaces) or a top-level key (0 spaces) ends the block.
		if (/^ {0,2}\S/.test(lines[index])) break;
		body.push(lines[index]);
	}
	return body.join("\n");
}

/**
 * Returns whether an explicit Compose `user:` override runs as root.
 * No override returns undefined so the Dockerfile USER remains authoritative.
 * Variable-based overrides are treated as root/unsafe because CI cannot prove
 * they resolve to a non-root identity.
 */
export function composeUserOverrideRunsAsRoot(
	serviceBlock: string | undefined,
): boolean | undefined {
	if (!serviceBlock) return undefined;
	const match = serviceBlock.match(/^\s*user:\s*(.+?)\s*$/m);
	if (!match) return undefined;
	const value = match[1].trim().replace(/^["']|["']$/g, "");
	const user = value.split(":")[0]?.trim().toLowerCase() ?? "";
	if (!user || user.startsWith("$")) return true;
	return user === "root" || user === "0";
}

/** Every `aquasecurity/trivy-action@<ref>` reference in a workflow. */
export function trivyActionRefs(content: string): string[] {
	return [...content.matchAll(/aquasecurity\/trivy-action@([^\s#]+)/g)].map((match) => match[1]);
}

/** Reads the `severity:` list from a step body, upper-cased and trimmed. */
export function parseSeverityList(body: string): string[] | undefined {
	const match = body.match(/^\s*severity:\s*(.+?)\s*$/m);
	if (!match) return undefined;
	return match[1]
		.split(",")
		.map((entry) => entry.trim().toUpperCase())
		.filter((entry) => entry.length > 0);
}

/** Reads the `id:` of a step, used to reference `steps.<id>.outcome`. */
export function stepId(step: WorkflowStep): string | undefined {
	return step.body.match(/^\s*id:\s*(\S+)\s*$/m)?.[1];
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
	const dockerfilesWithoutInstall: string[] = [];
	for (const [name, content] of Object.entries(source.dockerfiles)) {
		if (!/\bbun\s+install\b/.test(content)) {
			dockerfilesWithoutInstall.push(name);
			continue;
		}
		for (const problem of frozenInstallProblems(content)) {
			unpinnedInstalls.push(`${name}: ${problem}`);
		}
	}
	const frozenInstallOk = unpinnedInstalls.length === 0 && dockerfilesWithoutInstall.length === 0;
	push(
		"frozen-install-images",
		"Every `bun install` in every production image is frozen",
		frozenInstallOk,
		frozenInstallOk
			? `all installs in ${Object.keys(source.dockerfiles).length} Dockerfile(s) use --frozen-lockfile`
			: [
					unpinnedInstalls.length > 0
						? `missing --frozen-lockfile: ${unpinnedInstalls.join("; ")}`
						: "",
					dockerfilesWithoutInstall.length > 0
						? `no bun install found in: ${dockerfilesWithoutInstall.join(", ")}`
						: "",
				]
					.filter(Boolean)
					.join("; "),
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
	// traceable to the exact revision, not a mutable `:local` tag. Every
	// reference must be checked: a single `:local` scan must not be masked by
	// another step that still uses the revision tag.
	const shaRef = "${{ github.sha }}";
	const missingImages: string[] = [];
	const mutableImageRefs: string[] = [];
	for (const image of PRODUCTION_IMAGES) {
		const pattern = new RegExp(`image-ref:\\s*whatsapp-${image}:([^\\n]+)`, "g");
		const refs = [...source.productionInfraWorkflow.matchAll(pattern)].map((match) =>
			match[1].trim(),
		);
		if (!refs.includes(shaRef)) missingImages.push(image);
		const mutable = refs.filter((ref) => ref !== shaRef);
		if (mutable.length > 0) mutableImageRefs.push(`${image} -> ${mutable.join(", ")}`);
	}
	const scanCoverageOk = missingImages.length === 0 && mutableImageRefs.length === 0;
	push(
		"image-scan-coverage",
		"Every production image is vulnerability-scanned at its revision tag",
		scanCoverageOk,
		scanCoverageOk
			? `scanned at the revision tag: ${PRODUCTION_IMAGES.join(", ")}`
			: [
					missingImages.length > 0
						? `not scanned at the revision tag: ${missingImages.join(", ")}`
						: "",
					mutableImageRefs.length > 0
						? `mutable image refs: ${mutableImageRefs.join("; ")}`
						: "",
				]
					.filter(Boolean)
					.join("; "),
	);

	const scansLockfile = infraSteps.some((step) => isLockfileScan(step.body));
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

	// Each target needs its own enforcing step. Because those steps use
	// `continue-on-error: true`, a target can only fail the job through its own
	// `steps.<id>.outcome`, so a missing or weakened target is a real hole.
	const enforcementByTarget = new Map<string, WorkflowStep>();
	const missingTargets: string[] = [];
	for (const target of POLICY_TARGETS) {
		const step = infraSteps.find((candidate) => {
			if (!/exit-code:\s*"1"/.test(candidate.body)) return false;
			if (target.kind === "dependencies") {
				return isLockfileScan(candidate.body);
			}
			return candidate.body.includes(`image-ref: whatsapp-${target.image}:${shaRef}`);
		});
		if (step) enforcementByTarget.set(target.key, step);
		else missingTargets.push(target.key);
	}

	const enforcementProblems: string[] = [];
	for (const target of POLICY_TARGETS) {
		const step = enforcementByTarget.get(target.key);
		if (!step) continue;
		if (!/ignore-unfixed:\s*true/.test(step.body)) {
			enforcementProblems.push(`${target.key}: missing ignore-unfixed: true`);
		}
		const severities = parseSeverityList(step.body);
		if (!severities) {
			enforcementProblems.push(`${target.key}: no severity list`);
			continue;
		}
		const missingSeverities = BLOCKING_SEVERITIES.filter(
			(severity) => !severities.includes(severity),
		);
		if (missingSeverities.length > 0) {
			enforcementProblems.push(
				`${target.key}: severity "${severities.join(",")}" omits ${missingSeverities.join(",")}`,
			);
		}
	}
	const enforcementOk = missingTargets.length === 0 && enforcementProblems.length === 0;
	push(
		"blocking-policy",
		"Every target has an enforcing HIGH/CRITICAL scan with ignore-unfixed",
		enforcementOk,
		enforcementOk
			? `enforcing steps cover ${POLICY_TARGETS.map((target) => target.key).join(", ")}`
			: [
					missingTargets.length > 0 ? `no enforcing step for: ${missingTargets.join(", ")}` : "",
					...enforcementProblems,
				]
					.filter(Boolean)
					.join("; "),
	);

	const aggregationStep = infraSteps.find(
		(step) => /\.outcome/.test(step.body) && /exit\s+"?\$failed"?/.test(step.body),
	);

	// Every enforcing step's outcome must be read by the aggregating step: an
	// outcome that is dropped from the loop can no longer fail the job.
	const unreferencedOutcomes: string[] = [];
	const enforcementWithoutId: string[] = [];
	for (const target of POLICY_TARGETS) {
		const step = enforcementByTarget.get(target.key);
		if (!step) continue;
		const id = stepId(step);
		if (!id) {
			enforcementWithoutId.push(target.key);
			continue;
		}
		if (!aggregationStep || !aggregationStep.body.includes(`steps.${id}.outcome`)) {
			unreferencedOutcomes.push(`${target.key} (steps.${id}.outcome)`);
		}
	}
	const aggregationOk =
		Boolean(aggregationStep) &&
		unreferencedOutcomes.length === 0 &&
		enforcementWithoutId.length === 0;
	push(
		"blocking-policy-aggregated",
		"Every enforcing scan outcome is aggregated into a failing job step",
		aggregationOk,
		aggregationOk
			? `aggregated by step "${aggregationStep?.name}"`
			: !aggregationStep
				? "no step aggregates the policy outcomes into a failure"
				: [
						unreferencedOutcomes.length > 0
							? `outcomes not referenced: ${unreferencedOutcomes.join(", ")}`
							: "",
						enforcementWithoutId.length > 0
							? `enforcing step without an id: ${enforcementWithoutId.join(", ")}`
							: "",
					]
						.filter(Boolean)
						.join("; "),
	);

	// One pinned reference is not enough: every invocation must be pinned, or an
	// individual report/enforcement scan can silently lose its supply-chain pin.
	const scannerRefs = trivyActionRefs(source.productionInfraWorkflow);
	const floatingScannerRefs = scannerRefs.filter((ref) => !/^[0-9a-f]{40}$/.test(ref));
	const scannerPinnedOk = scannerRefs.length > 0 && floatingScannerRefs.length === 0;
	push(
		"scanner-pinned",
		"Every vulnerability scanner action reference is pinned to a commit SHA",
		scannerPinnedOk,
		scannerPinnedOk
			? `all ${scannerRefs.length} trivy-action reference(s) pinned to a 40-character commit SHA`
			: scannerRefs.length === 0
				? "no aquasecurity/trivy-action reference found"
				: `not pinned to a commit SHA: ${floatingScannerRefs.join(", ")}`,
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

	// --- Documented runtime exposure ---------------------------------------

	// The exception rationale leans on a non-root compensating control, so the
	// documented exposure must match what the image and Compose actually do.
	// This is bidirectional: making the migrator non-root without updating the
	// doc fails just as loudly as dropping a real root restriction.
	const migratorStage = parseDockerStages(
		source.dockerfiles["infra/docker/api.Dockerfile"] ?? "",
	).find((stage) => stage.name === "migrator");
	const migrateService = composeServiceBlock(source.composeProduction, "migrate");
	const composeUserOverrideIsRoot = composeUserOverrideRunsAsRoot(migrateService);
	const migratorRunsAsRoot =
		composeUserOverrideIsRoot ??
		(migratorStage ? stageRunsAsRoot(migratorStage.body) : true);

	const docClaimsMigratorRoot = /whatsapp-migrator[^\n]*runs as root/i.test(source.policyDoc);
	const docClaimsMigratorNonRoot = /whatsapp-migrator[^\n]*runs as non-root/i.test(
		source.policyDoc,
	);
	const exposureDocumented = migratorRunsAsRoot
		? docClaimsMigratorRoot && !docClaimsMigratorNonRoot
		: docClaimsMigratorNonRoot && !docClaimsMigratorRoot;
	push(
		"migrator-exposure-documented",
		"The migrator's runtime user is documented accurately",
		exposureDocumented,
		exposureDocumented
			? `documented as ${migratorRunsAsRoot ? "root" : "non-root"}, matching the image`
			: migratorRunsAsRoot
				? "whatsapp-migrator runs as root but the policy doc does not say so"
				: "whatsapp-migrator is non-root but the policy doc still documents root exposure",
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
		composeProduction: readFileSync("docker-compose.production.yml", "utf8"),
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
