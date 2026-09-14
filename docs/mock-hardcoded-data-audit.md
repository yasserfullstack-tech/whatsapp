# Production mock and hardcoded-data audit

Branch: `audit/mock-hardcoded-data`  
Scope: `apps/web`, `apps/api`, `apps/worker`, `packages/*`, production Docker/deployment configuration, and production environment configuration.

## Audit policy

The audit distinguishes production business/runtime data from legitimate source constants and non-production fixtures. The regression guard in `tests/production-mock-audit.test.ts` excludes load tests, E2E/unit/security fixtures, Drizzle migrations, and migration test data. Remaining exceptions are narrow, path-specific allowlist rules rather than a blanket keyword suppression.

The following are intentionally **not** production findings unless they cross into production runtime behavior:

- `apps/load-test` and its intentional local fake Meta Graph API.
- Playwright, unit-test, security-test, and migration fixtures.
- Drizzle migrations and deterministic migration seed identifiers.
- Static marketing/legal copy and product naming.
- UI input placeholders.
- Protocol/status/domain constants and vendor API origins.

## Findings and disposition

### High severity — production mock/fake behavior removed

1. **Notification email delivery selected a non-delivering provider in production.**  
   Classification: **4 — Production mock/fake data/code path**.  
   Fix: production notification delivery now uses the configured Resend provider. Console delivery remains non-production only. Production worker startup requires the provider credentials.

2. **Campaign personalization invented recipient data.** Missing contact names could become `there`, and missing literal bindings could become `-`.  
   Classification: **4 — Production mock/fake data** and **6 — Suspicious fallback hiding a real failure**.  
   Fix: campaign creation requires explicit literal values/name fallbacks and dispatch fails malformed historical bindings instead of synthesizing customer message content.

### High severity — dangerous production configuration removed

3. **Redis could silently resolve to loopback through defaults.**  
   Classification: **5 — Dangerous hardcoded configuration**.  
   Fix: web runtime requires `REDIS_URL`; API/worker production validation rejects loopback Redis hosts, including `.localhost` names.

4. **Worker public application URL was required but was not previously rejected when it pointed to loopback.**  
   Classification: **5 — Dangerous hardcoded configuration**.  
   Fix: worker environment validation now requires a non-loopback `APP_URL` in production.

5. **Public metadata/robots/sitemap could previously derive a localhost origin.**  
   Classification: **5 — Dangerous hardcoded configuration** and **6 — Suspicious fallback**.  
   Fix: production public URL resolution is centralized and fails on missing or loopback values. Development retains an explicit local-only fallback. Robots and sitemap resolve the runtime URL dynamically so Docker build-time placeholder values cannot leak into deployed SEO URLs.

6. **Global production `META_ACCESS_TOKEN` configuration was dead and misleading.** Actual sends already use encrypted per-number credentials from the database.  
   Classification: **7 — Dead/unreachable configuration**.  
   Fix: removed the global token from production compose/environment examples; no real token was added.

### Medium severity — fabricated fallback data removed

7. **Usage-limit notification copy fabricated `90%` when event metadata was absent.**  
   Classification: **4 — Production fake data** and **6 — Suspicious fallback**.  
   Fix: notification rendering uses the real percentage when supplied and neutral copy when the producing event omitted it.

8. **Customer-facing account/security/settings copy bypassed the EN/AR localization path.**  
   Classification: **3 — UI copy/content** with a production-readiness defect.  
   Fix: workspace General, Team, Security, WhatsApp, Notification settings plus account recovery, email verification, MFA, account security, workspace invitation, account-disabled/workspace-suspended states, notification navigation, and reports loading use locale-driven copy. Static product names remain static.

### Intentional / safe findings retained

9. **`.env.production.example` contains `example.com` and placeholder values.**  
   Classification: **2 — Legitimate configuration template**.  
   Why safe: the file contains no credentials and is not runtime configuration. Required production variables use placeholders specifically to prevent secret commits. It is explicitly allowlisted by the static audit.

10. **Container-local `127.0.0.1` health/monitoring bindings and `GF_SERVER_DOMAIN=localhost`.**  
    Classification: **2 — Legitimate configuration**.  
    Why safe: Prometheus and Grafana are bound to the VPS loopback interface; service health probes address the service from inside its own container. These values do not become customer-facing application URLs.

11. **Development/test loopback defaults in public URL, notification, and queue configuration.**  
    Classification: **1 — Intentional test/dev-only behavior**.  
    Why safe: production validation fails closed for public app/Redis loopback values. CI supplies the reserved `https://app.e2e.test` public origin while local services still bind to loopback.

12. **Workspace invitation action still contains `BETTER_AUTH_URL ?? http://127.0.0.1:3000`.**  
    Classification: **7 — Dead/unreachable fallback**.  
    Why safe: the module imports `db` from `apps/web/lib/server.ts`; that module requires `BETTER_AUTH_URL` during initialization before the invitation action can execute. Therefore the fallback cannot be reached in a running production web process. It is kept only to avoid an unrelated rewrite of the workspace-action module and is explicitly allowlisted.

13. **Meta/Facebook/Resend service origins and Graph API version.**  
    Classification: **2 — Legitimate constant/configuration**.  
    Why safe: these identify documented external providers/protocol versions rather than tenant/business data or credentials. Secrets remain environment- or database-driven.

14. **Billing plan codes, entitlement keys, throughput/concurrency defaults, queue/status names, and health states.**  
    Classification: **2 — Legitimate domain/configuration constants**.  
    Why safe: prices, usage, subscriptions, analytics, and tenant state are database-backed. Deterministic plan UUIDs found during review exist in migrations/seed history, which is intentionally excluded from the runtime regression guard.

15. **`sample` returned by audience segment preview.**  
    Classification: **2 — Legitimate API field name**.  
    Why safe: it contains a live query preview of tenant-scoped database results, not sample/fake contacts. The path is explicitly allowlisted.

16. **Static marketing/legal language and platform-admin English UI.**  
    Classification: **3 — UI copy/content**.  
    Why safe: marketing/legal pages are intentionally static content, and `/admin` is the internal operator control plane rather than fabricated customer data. Customer-facing application routes are covered by the i18n regression check. Admin localization can be handled separately without changing authorization/runtime semantics in this audit.

17. **Intentional fake Meta implementation used by load/stress tests.**  
    Classification: **1 — Intentional test/dev-only fixture**.  
    Why safe: it remains inside the test/load boundary and is required to guarantee load tests never send traffic or hundreds of thousands of messages to real Meta.

## Regression/static checks

`tests/production-mock-audit.test.ts` now fails when production-surface files introduce unclassified:

- mock/fake/dummy/fixture/hardcoded/TODO/FIXME markers;
- ambiguous demo/sample/placeholder/temporary/fallback markers outside narrow safe contexts;
- loopback or `example.com` URLs outside documented safe configuration;
- literal credential-like values;
- fixed tenant/business IDs or UUID literals; or
- customer-facing English JSX that bypasses the localization path.

Every retained match has either a narrow code allowlist rule or an excluded non-production/static-content boundary documented above.

## Verification gates

The branch is not considered ready until its final head passes:

- `bun run test`
- `bun run typecheck`
- `bun run build`
- browser E2E for EN/AR desktop/tablet/mobile
- the repository Security workflow
- production-infrastructure validation

No load-test traffic is directed at real Meta, and no production/customer Postgres or Valkey instance is used by these checks.
