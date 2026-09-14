import { coverageManifest as manifest, type CoverageEntry } from "../../qa/coverage-manifest.ts";

async function files(pattern: string): Promise<string[]> {
  const glob = new Bun.Glob(pattern);
  const result: string[] = [];
  for await (const file of glob.scan({ cwd: process.cwd(), onlyFiles: true })) result.push(file);
  return result.sort();
}

async function assertFile(path: string, label: string): Promise<void> {
  if (!(await Bun.file(path).exists())) throw new Error(`${label} references missing file: ${path}`);
}

function validateEntry(group: string, item: CoverageEntry): void {
  if (!["covered", "partial", "gap"].includes(item.status)) throw new Error(`${group} has invalid status: ${JSON.stringify(item)}`);
  if (item.status === "gap" && !item.gapReason) throw new Error(`${group} gap needs gapReason: ${item.route ?? item.name ?? item.role ?? item.boundary}`);
  if (item.status !== "gap" && item.tests.length === 0) throw new Error(`${group} ${item.status} entry needs at least one executable test reference: ${item.route ?? item.name ?? item.role ?? item.boundary}`);
}

async function checkRouteInventory(group: "pages" | "apiRoutes", pattern: string): Promise<void> {
  const discovered = await files(pattern);
  const entries = manifest[group];
  const registered = new Set(entries.flatMap((entry) => entry.source ? [entry.source] : []));

  const missing = discovered.filter((source) => !registered.has(source));
  if (missing.length) {
    throw new Error(`New ${group} source(s) are missing from qa/coverage-manifest.ts:\n${missing.map((value) => `  - ${value}`).join("\n")}`);
  }

  const stale = [...registered].filter((source) => !discovered.includes(source));
  if (stale.length) {
    throw new Error(`Stale ${group} source(s) remain in qa/coverage-manifest.ts:\n${stale.map((value) => `  - ${value}`).join("\n")}`);
  }
}

await checkRouteInventory("pages", "apps/web/app/**/page.tsx");
await checkRouteInventory("apiRoutes", "apps/web/app/**/route.ts");

for (const [group, entries] of Object.entries({
  pages: manifest.pages,
  apiRoutes: manifest.apiRoutes,
  workflows: manifest.workflows,
  roles: manifest.roles,
  securityBoundaries: manifest.securityBoundaries,
})) {
  for (const item of entries) {
    validateEntry(group, item);
    if (item.source) await assertFile(item.source, `${group} source`);
    for (const test of item.tests) await assertFile(test, `${group} test`);
  }
}

const summarize = (entries: CoverageEntry[]) => ({
  total: entries.length,
  covered: entries.filter((entry) => entry.status === "covered").length,
  partial: entries.filter((entry) => entry.status === "partial").length,
  gap: entries.filter((entry) => entry.status === "gap").length,
});

console.table({
  pages: summarize(manifest.pages),
  apiRoutes: summarize(manifest.apiRoutes),
  workflows: summarize(manifest.workflows),
  roles: summarize(manifest.roles),
  securityBoundaries: summarize(manifest.securityBoundaries),
});
console.log(`Registered load scenarios: ${manifest.loadScenarios.length}`);
console.log("QA coverage manifest is structurally current. Existing gaps remain visible and do not count as covered.");
