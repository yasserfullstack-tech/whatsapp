# Security testing

This suite is the security regression harness for the multi-tenant application. Production fixes discovered by the suite should be merged with the regression that proves the boundary.

## Core rule: tenant isolation

For every tenant-owned resource, a caller from Organization A using an identifier that belongs to Organization B must receive `404`, `403`, or a non-enumerating validation response. The response must never include Organization B data, metadata, secrets, object keys, phone numbers, template contents, analytics, or existence-sensitive detail.

Tenant filters are enforced server-side at the data-access boundary. Client-supplied organization identifiers and workspace-selection cookies are never authoritative.

## Current executable coverage

The Playwright security suite provisions real authenticated users/workspaces against PostgreSQL, seeds tenant-owned resources, and attacks them through the application HTTP boundary.

Cross-tenant and authorization regressions cover:

- campaign detail and campaign-control IDOR
- contact-import read and queue IDOR
- contact suppression and consent-restoration IDOR
- foreign list IDs embedded in segment definitions
- foreign WhatsApp phone-number IDs in campaign creation
- foreign template IDs in campaign creation
- forged workspace-selection cookies
- workspace data-export role enforcement
- workspace export exclusion of credential keys and encrypted secret material
- workspace-owner versus platform-administrator separation

Request and abuse regressions cover:

- anonymous access to protected application APIs, including settings export
- malformed opaque, JWT-shaped, and UUID-shaped session tokens
- revoked authenticated sessions through the real sign-out lifecycle
- cross-site mutation requests rejected by the Next.js request boundary
- stored markup/XSS payload escaping in workspace-controlled text
- oversized and invalid CSV upload metadata
- presigned upload tenant prefix, filename sanitization, expiry, and signed `content-type`
- production browser-hardening headers

Existing lower-level tests also cover Meta webhook signature validation and structured-log secret redaction.

## Coverage matrix

`N/A` means the application does not currently expose an identifier-bearing endpoint for that resource. When such an endpoint is added, the corresponding regression should land in the same feature PR.

| Area | Cross-tenant / isolation | Authorization | Anonymous / session | Abuse / leakage | Current status |
| --- | --- | --- | --- | --- | --- |
| contacts | suppress/resubscribe IDOR covered | authenticated workspace boundary | covered on existing actions | stored user text escaped by React | covered for current endpoints |
| lists | foreign list reference rejected | tenant-scoped validation | indirect through protected segment API | schema validation | covered for current endpoints |
| segments | tenant-owned list filters enforced | authenticated workspace boundary | create covered | input schema + CSRF boundary | covered for current endpoints |
| templates | foreign template campaign reference rejected | tenant-scoped campaign validation | create/sync covered | response does not expose foreign template | covered for current endpoints |
| campaigns | detail/control IDOR + foreign phone/template references covered | authenticated workspace boundary | create/detail/control covered | malformed sessions + CSRF covered | covered for current endpoints |
| campaign recipients | N/A — no public recipient-by-id endpoint | N/A | N/A | N/A | add regression with endpoint |
| imports | read/queue IDOR covered | authenticated workspace boundary | presign/read/queue covered | size/type validation + signed-upload restrictions | covered for current endpoints |
| phone numbers | foreign campaign reference rejected | tenant-scoped campaign validation | embedded signup protected | no foreign phone metadata leakage | covered for current endpoints |
| consent records | enforced through contact IDOR actions | authenticated workspace boundary | protected | evidence input validated | covered for current endpoints |
| suppressions | enforced through contact IDOR actions | authenticated workspace boundary | protected | input validated | covered for current endpoints |
| analytics | N/A — no standalone analytics API | N/A | N/A | N/A | add regression with endpoint |
| settings | forged workspace cookie rejected; export stays tenant-scoped | workspace role matrix + export role E2E | export anonymous access covered | secret-free export + CSRF boundary | covered for current surfaces |
| members | tenant context + workspace permission matrix | Owner/Admin/Member/Viewer matrix unit-tested | server-rendered/settings boundary | server-side actions re-check permissions | covered for current surfaces |
| credentials | never selected into workspace export | tenant-scoped credential lookup | protected indirectly | export and logger secret-leakage regressions | covered for current surfaces |
| admin | workspace owner is not platform admin | separate platform-admin grant boundary | protected | no workspace-role escalation | covered for current surfaces |

## Remaining rules for future endpoints

The security suite should grow with the product rather than invent endpoints that do not exist. Add focused regressions when new surfaces introduce:

- list, segment, template, phone-number, recipient, analytics, credential, or member ID routes
- search/filter/sort parameters that create new SQL-query construction paths
- direct multipart or raw CSV upload endpoints
- additional platform-admin mutation endpoints
- new R2 object-read/download URLs
- new webhook event types or replay semantics

For all new state-changing cookie-authenticated custom `/api/*` routes, the shared request boundary applies automatically. Better Auth routes retain Better Auth's own trusted-origin handling.

## CI security gates

`.github/workflows/security.yml` runs independently from the main CI workflow and includes:

- `bun audit --audit-level=high` for dependency vulnerabilities
- Gitleaks repository-history secret scanning
- CodeQL JavaScript/TypeScript `security-extended` static analysis
- the isolated Playwright security suite against clean PostgreSQL and Valkey services
- isolated fake R2 signing credentials for presign-policy tests; no real storage account is contacted

Container/image scanning remains deferred until container images become part of the deployment path.

## Running locally

Bring up infrastructure, migrate the database, build the web app, then run the security suite:

```bash
bun run infra:up
bun run db:migrate
bun run build
bun run test:security
```

The suite uses generated `example.test` accounts and removes the organizations, application users, and Better Auth users it creates after the run.

## Adding a tenant-isolation regression

Prefer black-box HTTP tests. Seed the victim resource directly in the database only when the normal creation flow requires unrelated external systems such as Meta or R2. Always authenticate as a different organization for the attack request and assert both:

1. the response is `404`, `403`, or a non-enumerating validation response; and
2. the victim resource was not read, changed, queued, deleted, or leaked through the response.

Whenever an identifier-bearing endpoint is added, its cross-tenant regression should be added in the same feature PR.