#!/usr/bin/env bun

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export type PlanItem = {
	item: string;
	checked: boolean;
	issue: number;
	line: number;
};

export type ReadinessRow = {
	item: string;
	checkbox: "[x]" | "[ ]";
	issue: number;
	issueState: "OPEN" | "CLOSED" | "UNKNOWN";
	result: "OK" | "MISMATCH";
	reason: string;
};

const PLAN_PATH = "docs/production-readiness-plan.md";
const GATE_RE = /^\s*-\s+\[(x|\s)\]\s+PR-(\d{3})\b.*#(\d+)\b/;

export function parsePlanItems(text: string): PlanItem[] {
	const items: PlanItem[] = [];
	for (const [index, line] of text.split("\n").entries()) {
		const match = line.match(GATE_RE);
		if (!match) continue;
		const checked = match[1] === "x";
		const item = `PR-${match[2]}`;
		const issue = Number.parseInt(match[3], 10);
		if (items.some((candidate) => candidate.item === item)) continue;
		items.push({ item, checked, issue, line: index + 1 });
	}
	return items;
}

export function compareItems(
	plan: PlanItem[],
	issueStates: Map<number, "OPEN" | "CLOSED">,
): ReadinessRow[] {
	return plan.map((entry) => {
		const issueState = issueStates.get(entry.issue) ?? "UNKNOWN";
		const checkbox = entry.checked ? "[x]" : "[ ]";
		let result: "OK" | "MISMATCH";
		let reason: string;
		if (issueState === "UNKNOWN") {
			result = "MISMATCH";
			reason = `#${entry.issue} was not found among the repository issues`;
		} else if (entry.checked && issueState === "OPEN") {
			result = "MISMATCH";
			reason = `checkbox is [x] (verified complete) but issue #${entry.issue} is still OPEN`;
		} else if (!entry.checked && issueState === "CLOSED") {
			result = "MISMATCH";
			reason = `checkbox is [ ] (not complete) but issue #${entry.issue} is CLOSED`;
		} else {
			result = "OK";
			reason = "checkbox and issue state agree";
		}
		return {
			item: entry.item,
			checkbox,
			issue: entry.issue,
			issueState,
			result,
			reason,
		};
	});
}

type Options = {
	planPath: string;
	repo: string | undefined;
};

function parseArgs(argv: string[]): Options {
	const opts: Options = { planPath: PLAN_PATH, repo: undefined };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--repo" && i + 1 < argv.length) {
			opts.repo = argv[++i];
		} else if (!arg.startsWith("--")) {
			opts.planPath = arg;
		}
	}
	return opts;
}

function fetchIssueStates(repo: string | undefined): Map<number, "OPEN" | "CLOSED"> {
	const args = [
		"issue",
		"list",
		...(repo ? ["-R", repo] : []),
		"--state",
		"all",
		"--json",
		"number,state",
		"--limit",
		"1000",
	];
	const stdout = execFileSync("gh", args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	const issues = JSON.parse(stdout) as Array<{ number: number; state: string }>;
	const states = new Map<number, "OPEN" | "CLOSED">();
	for (const issue of issues) {
		states.set(issue.number, issue.state === "CLOSED" ? "CLOSED" : "OPEN");
	}
	return states;
}

export function renderTable(rows: ReadinessRow[]): string {
	const mismatched = rows.filter((row) => row.result === "MISMATCH");
	const lines = [
		`| Item | Plan checkbox | Issue | Issue state | Check |`,
		`| --- | --- | --- | --- | --- |`,
		...rows.map(
			(row) =>
				`| ${row.item} | ${row.checkbox} | #${row.issue} | ${row.issueState} | ${row.result} |`,
		),
		"",
		`**Summary:** ${rows.length} items audited, ${mismatched.length} mismatch(es).`,
	];
	if (mismatched.length > 0) {
		lines.push("", "Mismatches:");
		for (const row of mismatched) {
			lines.push(`- ${row.item} / #${row.issue}: ${row.reason}`);
		}
	}
	return lines.join("\n");
}

function emitAnnotations(rows: ReadinessRow[], planPath: string): void {
	if (process.env.GITHUB_ACTIONS !== "true") return;
	for (const row of rows) {
		if (row.result !== "MISMATCH") continue;
		console.log(
			`::error file=${planPath},line=0,col=0::readiness drift: ${row.item} (#${row.issue}) ${row.reason}`,
		);
	}
}

async function main(): Promise<void> {
	const { planPath, repo } = parseArgs(Bun.argv.slice(2));

	let text: string;
	try {
		text = readFileSync(planPath, "utf8");
	} catch (error) {
		console.error(`failed to read plan file ${planPath}:`, error);
		process.exit(2);
	}

	const plan = parsePlanItems(text);
	if (plan.length === 0) {
		console.error(`no readiness checklist items (PR-001..PR-0NN) found in ${planPath}`);
		process.exit(2);
	}

	if (!Bun.which("gh")) {
		console.error("gh CLI is required but was not found on PATH");
		process.exit(2);
	}

	let states: Map<number, "OPEN" | "CLOSED">;
	try {
		states = fetchIssueStates(repo);
	} catch (error) {
		console.error("failed to query GitHub issues with gh:", error);
		process.exit(2);
	}

	const rows = compareItems(plan, states);
	console.log(renderTable(rows));
	emitAnnotations(rows, planPath);

	const mismatched = rows.filter((row) => row.result === "MISMATCH");
	if (mismatched.length > 0) {
		console.error(
			`\n${mismatched.length} readiness/issue state drift(s) detected. ` +
				"Reopen outstanding issues or advance evidence and update the plan checkbox together.",
		);
		process.exit(1);
	}
}

if (import.meta.main) {
	await main();
}
