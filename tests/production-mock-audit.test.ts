import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const ROOTS = [
  "apps/web",
  "apps/api",
  "apps/worker",
  "packages",
  "infra/production",
  "infra/docker",
] as const;
const ROOT_FILES = ["docker-compose.production.yml", ".env.production.example"] as const;
const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".json", ".yml", ".yaml", ".md", ".sql", ".toml"]);
const EXCLUDED = [
  /(^|\/)apps\/load-test(\/|$)/,
  /(^|\/)e2e(\/|$)/,
  /(^|\/)test(s)?(\/|$)/,
  /(^|\/)__tests__(\/|$)/,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /(^|\/)drizzle(\/|$)/,
  /(^|\/)migrations?(\/|$)/,
];
const SUSPICIOUS = /\b(mock|fake|dummy|demo|sample|fixture|placeholder|hardcoded|temporary|todo|fixme|localhost|example\.com)\b/i;
const SECRET_LITERAL = /\b(api[_-]?key|access[_-]?token|secret|password|verify[_-]?token)\b\s*[:=]\s*["'][^"'\n]{8,}["']/i;

async function walk(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await walk(child));
    else files.push(child);
  }
  return files;
}

function shouldInspect(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  if (EXCLUDED.some((pattern) => pattern.test(normalized))) return false;
  return TEXT_EXTENSIONS.has(extname(path)) || ROOT_FILES.includes(normalized as (typeof ROOT_FILES)[number]);
}

describe("production mock/hardcoded data audit", () => {
  test("inventory suspicious production literals", async () => {
    const discovered: string[] = [];
    for (const root of ROOTS) {
      for (const file of await walk(root)) {
        const normalized = relative(process.cwd(), file).replaceAll("\\", "/");
        if (shouldInspect(normalized)) discovered.push(normalized);
      }
    }
    for (const file of ROOT_FILES) discovered.push(file);

    const findings: string[] = [];
    for (const file of [...new Set(discovered)].sort()) {
      const content = await readFile(file, "utf8");
      for (const [index, line] of content.split(/\r?\n/).entries()) {
        if (SUSPICIOUS.test(line) || SECRET_LITERAL.test(line)) {
          findings.push(`${file}:${index + 1}: ${line.trim().slice(0, 400)}`);
        }
      }
    }

    console.log("PRODUCTION_AUDIT_FINDINGS_START");
    for (const finding of findings) console.log(finding);
    console.log("PRODUCTION_AUDIT_FINDINGS_END");
    console.log(`PRODUCTION_AUDIT_SCANNED_FILES=${new Set(discovered).size}`);
    console.log(`PRODUCTION_AUDIT_MATCHES=${findings.length}`);

    expect(discovered.length).toBeGreaterThan(0);
  });
});
