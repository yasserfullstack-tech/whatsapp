# Security testing

This suite is the security regression harness for the multi-tenant application. Production fixes discovered by the suite should be merged with the regression that proves the boundary.

## Core rule: tenant isolation

For every tenant-owned resource, a caller from Organization A using an identifier that belongs to Organization B must receive `404`, `403`, or another non-enumerating rejection. The response must never include Organization B data, metadata, secrets, object keys, phone numbers, template contents, analytics, billing data, or existence-sensitive detail.

Tenant filters are enforced server-side at the data-access boundary. Client-supplied organization identifiers, workspace identifiers, hidden form values, and workspace-selection cookies are never authoritative.

## Current executable coverage

The Playwright security suite provisions real authenticated users and workspaces against PostgreSQL and Valkey, seeds tenant-owned resources, and attacks them through the production-built application HTTP boundary. Lower-level Bun tests cover worker, webhook, persistence, and utility boundaries that are safer and more deterministic below the browser layer.

### Tenant isolation and IDOR

Executable regressions cover:

- campaign detail and campaign-control IDOR
- contact-import read and queue IDOR
- contact suppression and consent-restoration IDOR
- foreign list IDs embedded in segment definitions
- foreign WhatsApp phone-number IDs in campaign creation
- foreign template IDs in campaign creation
- forged workspace-selection cookies
- body/query attempts to select another organization
- report and report-export filters containing foreign campaign IDs
- notification unread counts scoped to both user and organization
- billing account, subscription, entitlement usage, and invoice isolation
- workspace export and export-download isolation
- R2 export keys constrained to the authenticated tenant prefix
- hidden membership IDs tampered to reference another workspace
- hidden WhatsApp phone-number IDs tampered to reference another workspace
- worker campaign-recipient claims constrained by organization, campaign, and recipient together

### Workspace roles and platform administration

The suite verifies:

- `Viewer` cannot create or mutate normal product resources
- `Member` can use normal product workflows but cannot administer consent or workspace-level controls
- `Admin` can perform permitted administration and exports but cannot perform owner-only workspace deletion
- `Owner` reaches owner-only destructive controls
- a workspace owner does not automatically become a platform administrator
- platform administrator access requires the separate platform-admin grant/bootstrap boundary
- disabling a user also blocks previously granted platform-admin access
- server actions re-resolve the authenticated workspace and permissions instead of trusting hidden IDs

### Authentication and session abuse

Executable regressions cover:

- cross-site credential sign-in requests rejected by Better Auth trusted-origin handling
- wrong-password and unknown-user sign-in failures without account enumeration
- password-reset responses without account enumeration
- password-reset throttling
- untrusted callback/reset URLs rejected instead of becoming open redirects
- oversized auth request bodies rejected without internal error leakage
- malformed, JWT-shaped, UUID-shaped, and unknown session tokens
- normal sign-out session revocation
- session expiry after removal from Better Auth's active Valkey secondary store and expiry in PostgreSQL
- attacker-chosen session cookie replacement on successful sign-in
- `HttpOnly`, `Secure`, and `SameSite=Lax` session-cookie attributes
- TOTP enrollment requiring proof
- password-only login blocked when MFA is enabled
- recovery codes accepted once and rejected on replay

### Invitations and destructive workflows

Executable regressions cover:

- invitations bound to the invited email address
- expired invitations rejected
- accepted invitations single-use and replay-safe
- invitation acceptance only creates membership in the intended workspace
- concurrent workspace-deletion requests serialize so only one active destructive schedule can be created
- workspace-deletion scheduling remains owner-only and requires recent authentication

### Request boundary, injection, XSS, and uploads

Executable regressions cover:

- cross-site cookie-authenticated mutations rejected before normal input processing
- authenticated mutations requiring an explicit trusted `Origin`
- missing, `null`, and spoofed origins rejected
- same-origin anonymous requests still reaching normal authentication rather than being misclassified as CSRF
- production CSP and browser-hardening headers
- stored organization-name markup rendered as text rather than executable HTML
- SQL metacharacters, comment syntax, `pg_sleep`-shaped input, and SQL/LIKE wildcard payloads treated as literal audience-filter values
- audience queries remaining scoped to the authenticated organization under malicious filter input
- oversized and non-CSV contact-import metadata rejected before signing
- upload object keys constrained to the authenticated tenant prefix
- uploaded filenames sanitized before becoming object-key components
- presigned upload expiry and signed `content-type` restrictions
- completed export downloads signed only for tenant-owned keys, with short-lived download URLs and `Cache-Control: no-store`
- CSV/report export cells hardened against spreadsheet-formula execution

### Webhooks, workers, and failure safety

Existing lower-level tests cover:

- valid Meta SHA-256 webhook HMAC acceptance
- missing, malformed, and incorrect webhook signatures rejected
- repeated identical webhook deliveries deduplicated into one durable inbox event / queue job
- replayed already-processed webhook events not requeued
- Redis queue failure leaving a durable webhook inbox event that can be retried
- database failures remaining retryable instead of being acknowledged as processed
- monotonic webhook delivery-state handling and worker reliability regressions
- campaign send-queue tenant scoping so a forged job cannot claim another organization's recipient
- structured-log secret redaction

## Coverage matrix

`N/A` means the application does not currently expose the specified identifier-bearing public surface. When such a surface is added, its regression should land in the same feature PR.

| Area | Cross-tenant / isolation | Authorization | Anonymous / session | Abuse / leakage | Current status |
| --- | --- | --- | --- | --- | --- |
| contacts | suppress/resubscribe IDOR covered | workspace role boundary | existing actions protected | stored text escaped; inputs validated | covered for current endpoints |
| lists | foreign list reference rejected | tenant-scoped validation | indirect through protected segment API | schema validation | covered for current endpoints |
| segments | foreign list and organization spoofing rejected | role matrix | create/preview protected | SQL/LIKE injection payloads covered | covered for current endpoints |
| templates | foreign template campaign reference rejected | tenant-scoped campaign validation | create/sync protected | no foreign template leakage | covered for current endpoints |
| campaigns | detail/control IDOR + foreign phone/template references | role matrix | create/detail/control protected | bad sessions + CSRF covered | covered for current endpoints |
| campaign recipients | worker claim requires org + campaign + recipient | queue-side tenant boundary | no public recipient-by-id route | forged queue job regression | covered at current worker boundary |
| imports | read/queue IDOR covered | role matrix | presign/read/queue protected | size/type/key/signing restrictions covered | content-parser fuzzing remains below |
| phone numbers | foreign campaign/server-action reference rejected | role matrix | embedded signup protected | credential remains untouched on foreign-ID tamper | covered for current surfaces |
| consent records | contact IDOR actions stay tenant-scoped | admin/owner boundaries | protected | evidence input validated | covered for current surfaces |
| suppressions | contact IDOR actions stay tenant-scoped | admin/owner boundaries | protected | input validated | covered for current surfaces |
| analytics/reports | foreign campaign filters cannot expose tenant B | authenticated workspace boundary | protected | CSV output hardened | covered for current report surfaces |
| settings | forged workspace selector rejected; exports tenant-scoped | Owner/Admin/Member/Viewer matrix | protected | CSRF + secret-free export | covered for current surfaces |
| members/invitations | hidden foreign membership ID rejected; invitation workspace fixed | role matrix + email binding | protected where required | expiry + single-use/replay covered | covered for current surfaces |
| credentials/object storage | tenant prefix and lookup boundaries | workspace/platform boundaries | protected indirectly | exports omit secrets; presigns short-lived | covered for current surfaces |
| billing | account/subscription/usage/invoice scoped to workspace | authenticated workspace boundary | protected | foreign billing sentinel absent | covered for current read surfaces |
| notifications | user + organization scoped | authenticated user boundary | unread endpoint protected | no foreign unread leakage | covered for current surfaces |
| platform admin | workspace ownership cannot grant access | separate admin grant + disabled-user check | protected | workspace-role escalation rejected | central guard covered; mutation probes can grow |
| webhooks | durable inbox and recipient updates tenant-aware | signed external boundary | N/A | HMAC, duplicate, replay, Redis/DB failure covered | covered at current API/worker boundary |

## Known remaining high-value coverage

The current branch intentionally does not claim that every future attack class is exhausted. The following additions remain worthwhile:

- run adversarial **CSV object contents** through the actual contact-import parser/worker path (malformed quoting, very large records, hostile Unicode, pathological column counts, invalid phones, duplicate-heavy files, and parser failure cleanup). Current tests cover upload metadata, signing policy, tenant object keys, and the worker's surrounding import behavior, but not a full hostile R2 object fixture end-to-end.
- add direct black-box submissions for each newly added platform-admin mutation. Current mutations share `requirePlatformAdmin()`, and the grant/disabled-user boundary is tested, but every future admin action should receive its own negative mutation probe where practical.
- add container/image vulnerability scanning to the release/deployment security pipeline when the image-release gate is finalized.
- continue adding explicit IDOR tests whenever new recipient, credential, analytics, member, template, list, phone-number, or other identifier-bearing routes are introduced.

## Rules for future endpoints

The security suite should grow with the product rather than invent endpoints that do not exist. Add focused regressions when new surfaces introduce:

- identifier-bearing read, mutation, export, or download routes
- search/filter/sort parameters that create new SQL-query construction paths
- direct multipart, raw CSV, or object-upload endpoints
- platform-admin mutation endpoints
- new R2 object-read/download URLs
- new webhook event types or replay semantics
- new queues whose payloads contain tenant-owned identifiers

For all new state-changing cookie-authenticated custom `/api/*` routes, the shared request boundary applies automatically. Better Auth routes retain Better Auth's own trusted-origin handling.

## CI security gates

`.github/workflows/security.yml` runs independently from the main CI workflow and includes:

- `bun audit --audit-level=high` for dependency vulnerabilities
- Gitleaks repository-history secret scanning
- CodeQL JavaScript/TypeScript `security-extended` static analysis
- the isolated Playwright security suite against clean PostgreSQL and Valkey services
- isolated fake R2 signing credentials for presign-policy tests; no real storage account is contacted

The main CI workflow separately verifies migration drift/schema state, unit/integration tests, TypeScript, the production web build, and the browser E2E suite.

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

1. the response is `404`, `403`, or another non-enumerating rejection; and
2. the victim resource was not read, changed, queued, deleted, or leaked through the response.

For server actions, preserve the real rendered action token/form protocol, replace only the attacker-controlled identifier, and verify the foreign row or secret remains unchanged.

Whenever an identifier-bearing endpoint is added, its cross-tenant regression should be added in the same feature PR.
