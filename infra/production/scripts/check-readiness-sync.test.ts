import { describe, expect, test } from "bun:test";
import { parsePlanItems } from "./check-readiness-sync";

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
