import { describe, expect, test } from "bun:test";
import { compareItems, parsePlanItems, renderTable, type PlanItem } from "./check-readiness-sync";

const SAMPLE_PLAN = [
	"# Paid-production launch gate",
	"",
	"- [x] PR-001 Production readiness tracking — [#46](https://github.com/yasserfullstack-tech/whatsapp/issues/46)",
	"- [ ] PR-002 Current Meta Embedded Signup migration — [#47](https://github.com/yasserfullstack-tech/whatsapp/issues/47)",
	"- [ ] PR-022 Application security hardening / independent testing — [#67](https://github.com/yasserfullstack-tech/whatsapp/issues/67)",
	"",
	"# Product-completeness / post-launch gate",
	"",
	"- [x] PR-014 Inbound inbox — [#59](https://github.com/yasserfullstack-tech/whatsapp/issues/59)",
	"- [ ] PR-015 Rich WhatsApp templates — [#60](https://github.com/yasserfullstack-tech/whatsapp/issues/60)",
	"",
	"## Completion discipline",
	"",
	"1. Confirm every Definition-of-done condition is actually satisfied.",
	"",
	"## [x] PR-001 — Production readiness tracking",
	"",
	"**Tracking:** [#46](https://github.com/yasserfullstack-tech/whatsapp/issues/46) · **Implementation:** [#68](https://github.com/yasserfullstack-tech/whatsapp/pull/68)",
].join("\n");

describe("check-readiness-sync plan parser", () => {
	test("parses top-level gate checkboxes PR-001..PR-022 in document order", () => {
		const items = parsePlanItems(SAMPLE_PLAN);
		expect(items).toEqual([
			{ item: "PR-001", checked: true, issue: 46, line: 3 },
			{ item: "PR-002", checked: false, issue: 47, line: 4 },
			{ item: "PR-022", checked: false, issue: 67, line: 5 },
			{ item: "PR-014", checked: true, issue: 59, line: 9 },
			{ item: "PR-015", checked: false, issue: 60, line: 10 },
		]);
	});

	test("does not double-count an item that also appears as an h2 header", () => {
		const items = parsePlanItems(SAMPLE_PLAN);
		// `## [x] PR-001` is a section header, not a task-list bullet, so it must
		// not produce a second PR-001 entry beyond the gate-list bullet.
		const headerLine = SAMPLE_PLAN.split("\n")[15];
		expect(headerLine.startsWith("## [x] PR-001")).toBe(true);
		expect(items.filter((entry) => entry.item === "PR-001").length).toBe(1);
	});

	test("ignores numbered completion-discipline lines without issue refs", () => {
		const items = parsePlanItems(SAMPLE_PLAN);
		expect(items.every((entry) => entry.issue !== undefined)).toBe(true);
	});

	test("deduplicates repeated items and reads unchecked state", () => {
		const plan = "- [ ] PR-002 — [#47](https://example.com/issues/47)\n- [ ] PR-002 — [#47](https://example.com/issues/47)\n";
		const items = parsePlanItems(plan);
		expect(items).toHaveLength(1);
		expect(items[0]).toEqual({ item: "PR-002", checked: false, issue: 47, line: 1 });
	});
});

const item = (name: string, checked: boolean, issue: number): PlanItem => ({
	item: name,
	checked,
	issue,
	line: 1,
});

describe("check-readiness-sync comparison", () => {
	test("flags a checked item whose issue is still open", () => {
		const rows = compareItems([item("PR-002", true, 47)], new Map([[47, "OPEN"]]));
		expect(rows).toHaveLength(1);
		expect(rows[0].result).toBe("MISMATCH");
		expect(rows[0].reason).toContain("#47 is still OPEN");
	});

	test("flags an unchecked item whose issue is closed", () => {
		const rows = compareItems([item("PR-003", false, 48)], new Map([[48, "CLOSED"]]));
		expect(rows[0].result).toBe("MISMATCH");
		expect(rows[0].reason).toContain("#48 is CLOSED");
	});

	test("accepts the aligned checked+closed and unchecked+open pairs", () => {
		const rows = compareItems(
			[item("PR-001", true, 46), item("PR-004", false, 49)],
			new Map<number, "OPEN" | "CLOSED">([
				[46, "CLOSED"],
				[49, "OPEN"],
			]),
		);
		expect(rows.map((row) => row.result)).toEqual(["OK", "OK"]);
	});

	test("flags an issue that is missing from the repository", () => {
		const rows = compareItems([item("PR-005", false, 999)], new Map());
		expect(rows[0].issueState).toBe("UNKNOWN");
		expect(rows[0].result).toBe("MISMATCH");
	});
});

describe("check-readiness-sync table", () => {
	test("renders every row and a zero-mismatch summary when aligned", () => {
		const rows = compareItems(
			[item("PR-001", true, 46), item("PR-002", false, 47)],
			new Map<number, "OPEN" | "CLOSED">([
				[46, "CLOSED"],
				[47, "OPEN"],
			]),
		);
		const table = renderTable(rows);
		expect(table).toContain("| PR-001 | [x] | #46 | CLOSED | OK |");
		expect(table).toContain("| PR-002 | [ ] | #47 | OPEN | OK |");
		expect(table).toContain("2 items audited, 0 mismatch(es)");
		expect(table).not.toContain("Mismatches:");
	});

	test("lists every mismatch reason when drift exists", () => {
		const rows = compareItems([item("PR-003", false, 48)], new Map([[48, "CLOSED"]]));
		const table = renderTable(rows);
		expect(table).toContain("1 items audited, 1 mismatch(es)");
		expect(table).toContain("Mismatches:");
		expect(table).toContain("- PR-003 / #48:");
	});
});
