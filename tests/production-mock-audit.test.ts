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

const HIGH_RISK_MARKER = /\b(mock|fake|dummy|fixture|hardcoded|todo|fixme)\b|simulated\s+success/i;
const AMBIGUOUS_MARKER = /\b(demo|sample|placeholder|temporary|fallback)\b/i;
const LOOPBACK_URL = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|[^/"'\s]*\.localhost)(?::\d+)?/i;
const EXAMPLE_URL = /https?:\/\/[^/"'\s]*example\.com\b/i;
const LOCAL_IMAGE_TAG = /\b[a-z0-9./_-]+:local\b/i;
const SECRET_LITERAL = /\b(api[_-]?key|access[_-]?token|secret|password|verify[_-]?token)\b\s*[:=]\s*["'][^"'\n]{8,}["']/i;
const FIXED_ID = /\b(?:organization|user|waba|phone(?:Number)?|template|campaign)(?:_?id|Id)\b\s*[:=]\s*["'][A-Za-z0-9_-]{6,}["']/i;
const UUID_LITERAL = /["'][0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}["']/i;
const JSX_ENGLISH = />\s*[A-Za-z][A-Za-z0-9 ,.'’:/()&+\-]{2,}\s*</;

const I18N_EXCLUDED = [
  /^apps\/web\/app\/admin\//,
  /^apps\/web\/components\/admin-/,
  /^apps\/web\/components\/marketing\//,
  /^apps\/web\/lib\/marketing-content\.tsx?$/,
  /^apps\/web\/components\/data-lifecycle-panel\.tsx$/,
];

const SEMANTIC_FALLBACK_FILES = new Set([
  "apps/web/app/api/campaigns/route.ts",
  "apps/web/components/campaign-builder.tsx",
  "apps/web/components/mfa-security-card.tsx",
  "apps/worker/src/campaigns.ts",
  "packages/queue/src/index.ts",
]);
const AUDIENCE_SAMPLE_FILES = new Set([
  "apps/web/app/api/audiences/preview/route.ts",
  "apps/web/app/api/audiences/segments/preview/route.ts",
  "apps/web/components/audience-manager.tsx",
]);

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

function isAllowedFinding(file: string, line: string): boolean {
  if (file === ".env.production.example") return true;
  if (file.startsWith("apps/web/lib/i18n/")) return true;
  if (/\.tsx?$/.test(file) && /\bplaceholder\s*=/.test(line)) return true;
  if (file === "apps/web/lib/marketing-content.ts") return true;
  if (AUDIENCE_SAMPLE_FILES.has(file) && /\bsample\b/.test(line)) return true;
  if (SEMANTIC_FALLBACK_FILES.has(file) && /\bfallback\b/.test(line)) return true;
  if (file === "apps/web/lib/public-app-url.ts" && /localhost|127\.0\.0\.1|::1/.test(line)) return true;
  if (file === "apps/worker/src/notification-runtime.ts" && /127\.0\.0\.1/.test(line)) return true;
  if (file === "packages/config/src/index.ts" && /localhost|127\.0\.0\.1|::1/.test(line)) return true;
  if (["packages/notifications/src/index.ts", "packages/notifications/src/email.ts"].includes(file) && /127\.0\.0\.1/.test(line)) return true;
  if (file === "docker-compose.production.yml" && /127\.0\.0\.1|GF_SERVER_DOMAIN:\s*localhost/.test(line)) return true;
  if (file === "apps/web/lib/workspace-actions.ts" && /BETTER_AUTH_URL.*127\.0\.0\.1/.test(line)) return true;
  return false;
}

function isAllowedEnglishJsx(file: string, line: string): boolean {
  if (I18N_EXCLUDED.some((pattern) => pattern.test(file))) return true;
  return />\s*WhatsApp Campaigns\s*</.test(line);
}

describe("production mock/hardcoded data audit", () => {
  test("production runtime has no unclassified mock, fixed-ID, secret, loopback, or local-image data", async () => {
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
        const risky = HIGH_RISK_MARKER.test(line)
          || AMBIGUOUS_MARKER.test(line)
          || LOOPBACK_URL.test(line)
          || EXAMPLE_URL.test(line)
          || LOCAL_IMAGE_TAG.test(line)
          || SECRET_LITERAL.test(line)
          || FIXED_ID.test(line)
          || UUID_LITERAL.test(line);
        if (risky && !isAllowedFinding(file, line)) {
          findings.push(`${file}:${index + 1}: ${line.trim().slice(0, 400)}`);
        }
        if (
          file.startsWith("apps/web/")
          && file.endsWith(".tsx")
          && JSX_ENGLISH.test(line)
          && !isAllowedEnglishJsx(file, line)
        ) {
          i18nFindings.push(`${file}:${index + 1}: ${line.trim().slice(0, 400)}`);
        }
      }
    }

    if (findings.length) console.error(`Unclassified production audit findings:\n${findings.join("\n")}`);
    if (i18nFindings.length) console.error(`Unclassified customer-facing English JSX:\n${i18nFindings.join("\n")}`);

    expect(new Set(discovered).size).toBeGreaterThan(150);
    expect(findings).toEqual([]);
    expect(i18nFindings).toEqual([]);
  });
});
