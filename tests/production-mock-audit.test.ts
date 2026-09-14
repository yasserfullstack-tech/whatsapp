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
const FIXED_ID = /\b(?:organization|user|waba|phone(?:Number)?|template|campaign)(?:_?id|Id)\b\s*[:=]\s*["'][A-Za-z0-9_-]{6,}["']/i;
const UUID_LITERAL = /["'][0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}["']/i;
const HTTP_LITERAL = /["']https?:\/\/[^"']+["']/i;
const JSX_ENGLISH = />\s*[A-Za-z][A-Za-z0-9 ,.'’:/()&+\-]{2,}\s*</;

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
    const i18nFindings: string[] = [];
    for (const file of [...new Set(discovered)].sort()) {
      const content = await readFile(file, "utf8");
      for (const [index, line] of content.split(/\r?\n/).entries()) {
        if (SUSPICIOUS.test(line) || SECRET_LITERAL.test(line) || FIXED_ID.test(line) || UUID_LITERAL.test(line) || HTTP_LITERAL.test(line)) {
          findings.push(`${file}:${index + 1}: ${line.trim().slice(0, 400)}`);
        }
        if (file.startsWith("apps/web/") && file.endsWith(".tsx") && JSX_ENGLISH.test(line)) {
          i18nFindings.push(`${file}:${index + 1}: ${line.trim().slice(0, 400)}`);
        }
      }
    }

    console.log("PRODUCTION_AUDIT_FINDINGS_START");
    for (const finding of findings) console.log(finding);
    console.log("PRODUCTION_AUDIT_FINDINGS_END");
    console.log("PRODUCTION_I18N_FINDINGS_START");
    for (const finding of i18nFindings) console.log(finding);
    console.log("PRODUCTION_I18N_FINDINGS_END");
    console.log(`PRODUCTION_AUDIT_SCANNED_FILES=${new Set(discovered).size}`);
    console.log(`PRODUCTION_AUDIT_MATCHES=${findings.length}`);
    console.log(`PRODUCTION_I18N_MATCHES=${i18nFindings.length}`);

    expect(discovered.length).toBeGreaterThan(0);
  });
});
