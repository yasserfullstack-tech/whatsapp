export type CoverageStatus = "covered" | "partial" | "gap";

export type CoverageEntry = {
  route?: string;
  name?: string;
  role?: string;
  boundary?: string;
  source?: string;
  status: CoverageStatus;
  tests: string[];
  gapReason?: string;
};

type LoadScenario = { scenario: string; class: "required-release-smoke" | "heavy" | "dedicated-runner"; runner: string };

const entry = (id: Partial<CoverageEntry>, status: CoverageStatus, tests: string[] = [], gapReason?: string): CoverageEntry => ({ ...id, status, tests, ...(gapReason ? { gapReason } : {}) });
const page = (route: string, source: string, status: CoverageStatus, tests: string[] = [], gapReason?: string) => entry({ route, source }, status, tests, gapReason);
const api = (route: string, status: CoverageStatus, tests: string[] = [], gapReason?: string) => page(route, `apps/web/app${route}/route.ts`, status, tests, gapReason);
const appPage = (route: string, status: CoverageStatus, tests: string[] = [], gapReason?: string) => page(route, `apps/web/app${route}/page.tsx`, status, tests, gapReason);

const publicTest = ["e2e/public-site.e2e.ts"];
const responsiveTest = ["e2e/i18n-responsive.e2e.ts"];
const tenantTest = ["e2e/security/tenant-isolation.e2e.ts"];
const reportingSecurity = ["e2e/security/reporting-tenant-isolation.e2e.ts"];
const adminGap = "Platform-admin page interactions are not comprehensively browser-tested; privilege separation is covered at the security boundary.";

export const coverageManifest: {
  pages: CoverageEntry[];
  apiRoutes: CoverageEntry[];
  workflows: CoverageEntry[];
  roles: CoverageEntry[];
  securityBoundaries: CoverageEntry[];
  loadScenarios: LoadScenario[];
} = {
  pages: [
    page("/", "apps/web/app/(marketing)/page.tsx", "covered", publicTest),
    ...["features", "pricing", "whatsapp", "security", "contact", "privacy", "terms", "acceptable-use", "anti-spam"].map((slug) => page(`/${slug}`, "apps/web/app/(marketing)/[slug]/page.tsx", "covered", publicTest)),
    appPage("/sign-up", "covered", ["e2e/i18n-responsive.e2e.ts", "e2e/onboarding.e2e.ts"]),
    appPage("/sign-in", "covered", ["e2e/i18n-responsive.e2e.ts", "e2e/onboarding.e2e.ts"]),
    appPage("/verify-email", "covered", ["e2e/i18n-responsive.e2e.ts", "e2e/onboarding.e2e.ts"]),
    appPage("/forgot-password", "gap", [], "Forgot-password request flow has no browser regression."),
    appPage("/reset-password", "gap", [], "Valid/invalid reset-token behavior has no browser regression."),
    appPage("/two-factor", "gap", [], "TOTP challenge UX has no browser regression."),
    appPage("/invite/[token]", "gap", [], "Invitation acceptance is not covered end-to-end in the browser."),
    appPage("/account/security", "gap", [], "Session/password/MFA interactions lack browser E2E."),
    appPage("/account-disabled", "gap", [], "Disabled-account routing and recovery UX are not browser-tested."),
    appPage("/workspace-suspended", "gap", [], "Suspended-workspace routing and read-only behavior are not browser-tested."),
    appPage("/dashboard", "partial", responsiveTest, "Render/i18n are covered; dashboard actions/data correctness are not fully exercised."),
    appPage("/contacts", "partial", [...responsiveTest, ...tenantTest], "Render and security actions are covered; full contact CRUD/import behavior is not."),
    appPage("/audiences", "partial", [...responsiveTest, ...tenantTest], "Render and tenant boundaries exist; complete list/segment lifecycle is not browser-covered."),
    appPage("/templates", "partial", [...responsiveTest, ...tenantTest], "Render and foreign-template rejection are covered; create/sync lifecycle is incomplete."),
    appPage("/campaigns", "partial", [...responsiveTest, ...tenantTest], "Render/security are covered; full draft-to-launch-to-completion browser workflow is missing."),
    appPage("/campaigns/[id]", "partial", tenantTest, "Cross-tenant detail/control is covered; owner campaign-detail behavior is not browser-covered."),
    appPage("/onboarding", "covered", ["e2e/onboarding.e2e.ts"]),
    appPage("/notifications", "partial", ["e2e/security/notifications.e2e.ts"], "Security behavior is covered; read/mark-all-read/pagination browser behavior is incomplete."),
    ...["/reports", "/reports/campaigns", "/reports/templates", "/reports/audiences", "/reports/phone-numbers"].map((route) => appPage(route, "partial", [...responsiveTest, ...reportingSecurity], "Render/tenant isolation are covered; filters, comparisons, exports and metric correctness need broader browser assertions.")),
    appPage("/settings", "gap", [], "Settings landing/redirect behavior is not directly browser-tested."),
    appPage("/settings/general", "gap", [], "General workspace preference mutations are only indirectly covered."),
    appPage("/settings/team", "gap", [], "Invite/change-role/remove/transfer-ownership flows lack browser E2E."),
    appPage("/settings/whatsapp", "gap", [], "Connect/disconnect/reconnect UX is not browser-tested against fake Meta."),
    appPage("/settings/security", "gap", [], "Workspace security/audit interactions are not browser-tested."),
    appPage("/settings/notifications", "gap", [], "Notification preference mutations lack browser E2E."),
    appPage("/settings/billing", "partial", responsiveTest, "Render/i18n is covered; plan/entitlement/usage behavior is primarily lower-level."),
    appPage("/settings/data", "partial", [...responsiveTest, ...tenantTest], "Render/export authorization/secret exclusion are covered; complete export/deletion lifecycle is not browser-covered."),
    ...["/admin", "/admin/audit", "/admin/campaigns", "/admin/connections", "/admin/imports", "/admin/organizations", "/admin/organizations/[id]", "/admin/system", "/admin/users", "/admin/webhooks"].map((route) => appPage(route, "gap", [], adminGap)),
  ],
  apiRoutes: [
    api("/api/audiences/preview", "partial", tenantTest, "Audience query behavior is not comprehensively tested for all filter combinations."),
    api("/api/audiences/segments", "covered", tenantTest),
    api("/api/auth/[...all]", "partial", ["e2e/i18n-responsive.e2e.ts", "e2e/security/bad-session.e2e.ts"], "Core signup/signin/session paths are exercised, not every Better Auth endpoint."),
    api("/api/campaigns", "partial", tenantTest, "Tenant-bound creation checks exist; complete valid launch lifecycle is not API E2E."),
    api("/api/campaigns/[id]", "covered", tenantTest),
    api("/api/campaigns/[id]/control", "covered", tenantTest),
    api("/api/contact-imports/[id]", "covered", tenantTest),
    api("/api/contact-imports/presign", "covered", ["e2e/security/request-boundary.e2e.ts", "e2e/security/tenant-isolation.e2e.ts"]),
    api("/api/contacts/[id]/resubscribe", "covered", tenantTest),
    api("/api/contacts/[id]/suppress", "covered", tenantTest),
    api("/api/meta/embedded-signup/complete", "gap", [], "Embedded signup completion lacks a black-box fake-Meta API/browser regression."),
    api("/api/notifications/unread-count", "covered", ["e2e/security/notifications.e2e.ts"]),
    api("/api/reports/export", "covered", reportingSecurity),
    api("/api/settings/data/account-deletion", "partial", tenantTest, "Authorization is covered; complete cooling-off/deletion execution is not."),
    api("/api/settings/data/export", "covered", tenantTest),
    api("/api/settings/data/export/[id]/download", "partial", tenantTest, "Tenant/role boundary is covered; expiry/object-storage lifecycle needs dedicated E2E."),
    api("/api/settings/data/retention", "partial", ["apps/web/lib/workspace-access.test.ts"], "Role policy is unit-tested; HTTP mutation is not fully black-box tested."),
    api("/api/settings/data/workspace-deletion", "partial", tenantTest, "Authorization is covered; scheduled purge/cancellation lifecycle is not."),
    api("/api/templates", "partial", ["e2e/security/unauthenticated-api.e2e.ts", "e2e/security/tenant-isolation.e2e.ts"], "Protection/reference security is covered; valid template CRUD lifecycle is not."),
    api("/api/templates/sync", "partial", ["e2e/security/unauthenticated-api.e2e.ts"], "Anonymous protection is covered; fake-Meta sync behavior needs dedicated E2E."),
  ],
  workflows: [
    entry({ name: "Public marketing/legal navigation" }, "covered", publicTest),
    entry({ name: "Sign up -> email verification -> sign in" }, "covered", ["e2e/i18n-responsive.e2e.ts", "e2e/onboarding.e2e.ts"]),
    entry({ name: "Guided onboarding leave/resume/skip/complete" }, "covered", ["e2e/onboarding.e2e.ts"]),
    entry({ name: "Contact consent/suppression/resubscribe" }, "partial", tenantTest, "Security mutations are covered; complete happy path is not."),
    entry({ name: "Audience list/segment lifecycle" }, "partial", [...responsiveTest, ...tenantTest], "Full create/edit/delete lifecycle is not browser-covered."),
    entry({ name: "Template create/sync/use" }, "partial", [...responsiveTest, ...tenantTest], "Fake-Meta sync happy path is missing."),
    entry({ name: "Campaign draft -> snapshot -> dispatch -> delivery state" }, "partial", ["e2e/security/tenant-isolation.e2e.ts", "apps/worker/src/webhooks.test.ts", "apps/load-test/src/run.ts"], "One browser happy path through completion is still missing."),
    entry({ name: "Reporting filters/comparison/export" }, "partial", ["e2e/i18n-responsive.e2e.ts", "e2e/security/reporting-tenant-isolation.e2e.ts", "apps/load-test/src/reporting.ts"], "Report interactions/metric assertions are incomplete."),
    entry({ name: "Notification read/preferences lifecycle" }, "partial", ["e2e/security/notifications.e2e.ts", "packages/notifications/src/integration.test.ts"], "Browser interactions are incomplete."),
    entry({ name: "Workspace data export/retention/deletion" }, "partial", ["e2e/security/tenant-isolation.e2e.ts", "packages/db/src/data-lifecycle-purge.test.ts", "apps/web/lib/data-lifecycle.test.ts"], "Full async browser lifecycle is incomplete."),
    entry({ name: "Workspace team administration" }, "partial", ["apps/web/lib/workspace-access.test.ts"], "Permission matrix is unit-tested; browser team lifecycle is missing."),
    entry({ name: "Account password/session/MFA lifecycle" }, "gap", [], "No complete browser regression spans password reset, sessions and TOTP."),
    entry({ name: "WhatsApp embedded signup/connect/reconnect" }, "gap", [], "No complete fake-Meta black-box connection lifecycle is present."),
    entry({ name: "Platform administrator operations" }, "partial", tenantTest, "Privilege separation is covered; admin mutations/pages are not comprehensive."),
  ],
  roles: [
    ...["owner", "admin", "member", "viewer"].map((role) => entry({ role }, "covered", ["apps/web/lib/workspace-access.test.ts", "e2e/security/tenant-isolation.e2e.ts"])),
    entry({ role: "platform administrator" }, "partial", tenantTest, "Workspace/platform-admin separation is covered; full admin matrix is not."),
    entry({ role: "anonymous user" }, "covered", ["e2e/security/unauthenticated-api.e2e.ts", "e2e/security/bad-session.e2e.ts"]),
    entry({ role: "disabled account" }, "gap", [], "No dedicated E2E role case for disabled-account UX/API denial."),
    entry({ role: "suspended workspace" }, "gap", [], "No dedicated E2E role case for suspended-workspace UX/mutation denial."),
  ],
  securityBoundaries: [
    entry({ boundary: "Cross-tenant IDOR and forged workspace context" }, "covered", ["e2e/security/tenant-isolation.e2e.ts", "e2e/security/reporting-tenant-isolation.e2e.ts"]),
    entry({ boundary: "Anonymous and invalid/revoked sessions" }, "covered", ["e2e/security/unauthenticated-api.e2e.ts", "e2e/security/bad-session.e2e.ts"]),
    entry({ boundary: "Cross-site request boundary / CSRF" }, "covered", ["e2e/security/request-boundary.e2e.ts"]),
    entry({ boundary: "Stored markup/XSS escaping" }, "covered", ["e2e/security/request-boundary.e2e.ts"]),
    entry({ boundary: "Upload validation and presigned object-key isolation" }, "covered", ["e2e/security/request-boundary.e2e.ts", "e2e/security/tenant-isolation.e2e.ts"]),
    entry({ boundary: "Webhook HMAC, replay/idempotency and monotonic status" }, "covered", ["apps/api/src/webhook-signature.test.ts", "apps/api/src/webhook-inbox.test.ts", "apps/worker/src/webhooks.test.ts", "packages/meta/src/webhooks.test.ts"]),
    entry({ boundary: "Secret leakage/redaction" }, "covered", ["packages/observability/src/logger.test.ts", "e2e/security/tenant-isolation.e2e.ts"]),
    entry({ boundary: "Dependency, repository-secret and static analysis" }, "covered", [".github/workflows/security.yml"]),
  ],
  loadScenarios: [
    { scenario: "1 campaign / 80 MPS / 1k smoke", class: "required-release-smoke", runner: "bun run load:run -- --scenario=baseline-80 --recipients=1000 --timeout-ms=120000" },
    { scenario: "1k signed webhook flood", class: "required-release-smoke", runner: "bun run load:webhooks -- --events=1000 --concurrency=50 --timeout-ms=120000" },
    { scenario: "Worker restart / 1k resilience", class: "required-release-smoke", runner: "bun apps/load-test/src/chaos.ts --chaos=worker-restart --scenario=baseline-80 --recipients=1000" },
    ...["baseline-1000", "concurrent-10", "multi-org", "slow-meta", "meta-429", "meta-500"].map((scenario) => ({ scenario, class: "heavy" as const, runner: `apps/load-test/src/run.ts ${scenario}` })),
    ...["500k campaign", "100k webhook flood", "500k reporting", "soak", "destructive chaos"].map((scenario) => ({ scenario, class: "dedicated-runner" as const, runner: ".github/workflows/heavy-validation.yml" })),
  ],
};
