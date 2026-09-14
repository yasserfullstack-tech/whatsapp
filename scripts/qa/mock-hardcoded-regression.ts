import { existsSync } from "node:fs";

const baselinePath = "qa/mock-hardcoded-baseline.json";
const auditTest = "tests/production-mock-audit.test.ts";
const writeBaseline = process.argv.includes("--write-baseline");
const reviewed = process.argv.includes("--reviewed");

if (!existsSync(auditTest)) {
  throw new Error(`${auditTest} is missing. The audit/mock-hardcoded-data branch has not been integrated.`);
}
if (!existsSync(baselinePath)) throw new Error(`${baselinePath} is missing`);

const child = Bun.spawnSync(["bun", "test", auditTest], {
  stdout: "pipe",
  stderr: "pipe",
  env: process.env,
});
const stdout = child.stdout.toString();
const stderr = child.stderr.toString();
process.stdout.write(stdout);
process.stderr.write(stderr);
if (child.exitCode !== 0) process.exit(child.exitCode || 1);

function section(start: string, end: string, prefix: string): string[] {
  const startIndex = stdout.indexOf(start);
  const endIndex = stdout.indexOf(end);
  if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) {
    throw new Error(`Audit output did not contain expected markers ${start} / ${end}`);
  }
  return stdout
    .slice(startIndex + start.length, endIndex)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `${prefix}|${line.replace(/^(.+?):\d+:\s*/, "$1: ")}`);
}

const findings = [
  ...section("PRODUCTION_AUDIT_FINDINGS_START", "PRODUCTION_AUDIT_FINDINGS_END", "audit"),
  ...section("PRODUCTION_I18N_FINDINGS_START", "PRODUCTION_I18N_FINDINGS_END", "i18n"),
].sort();

if (writeBaseline) {
  if (!reviewed) {
    throw new Error("Writing the audit baseline requires --reviewed after a human review of every retained finding.");
  }
  const sha = Bun.spawnSync(["git", "rev-parse", "HEAD"], { stdout: "pipe" }).stdout.toString().trim();
  await Bun.write(baselinePath, `${JSON.stringify({ generatedFrom: sha, reviewedAt: new Date().toISOString(), findings }, null, 2)}\n`);
  console.log(`Wrote reviewed mock/hardcoded audit baseline with ${findings.length} retained finding(s) from ${sha}.`);
  process.exit(0);
}

const baseline = JSON.parse(await Bun.file(baselinePath).text()) as {
  generatedFrom?: string;
  findings?: string[];
};
if (!baseline.generatedFrom || baseline.generatedFrom.startsWith("PENDING_")) {
  throw new Error("Mock/hardcoded audit baseline is pending combined-main review; this branch cannot pass final validation yet.");
}

const allowed = new Set(baseline.findings ?? []);
const unreviewed = findings.filter((finding) => !allowed.has(finding));
if (unreviewed.length > 0) {
  console.error("Unreviewed production mock/hardcoded findings were introduced:");
  for (const finding of unreviewed) console.error(`  ${finding}`);
  console.error("Fix the production issue or explicitly review it before updating the baseline.");
  process.exit(1);
}

const removed = [...allowed].filter((finding) => !findings.includes(finding));
if (removed.length > 0) {
  console.log(`${removed.length} previously reviewed finding(s) are gone; baseline cleanup is optional and should be reviewed separately.`);
}
console.log(`Mock/hardcoded regression audit passed: ${findings.length} current finding(s), 0 unreviewed additions.`);
