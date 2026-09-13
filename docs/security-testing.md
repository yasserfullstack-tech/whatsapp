# Security testing branch

This branch is a security regression harness. Production fixes discovered here should normally be implemented in small `fix/security-*` branches and merged independently.

## Core rule: tenant isolation

For every tenant-owned resource, a caller from Organization A using an identifier that belongs to Organization B must receive `404` or `403`. The response must never include Organization B data, metadata, secrets, object keys, phone numbers, template contents, analytics, or existence-sensitive detail.

Tenant filters must be enforced server-side at the data-access boundary. A client-supplied organization ID is never authoritative.

## Current executable coverage

The security Playwright suite currently provisions two real authenticated users/workspaces against PostgreSQL, seeds Organization B resources, then attacks them using Organization A's session.

Implemented cross-tenant regressions:

- campaign detail IDOR
- campaign control IDOR
- contact import read IDOR
- contact import queue IDOR
- contact suppression IDOR
- contact consent restoration IDOR

Implemented anonymous-access probes:

- audience preview
- segment creation
- campaign creation/detail/control
- contact-import presign/read/queue
- contact suppression/resubscribe
- template creation/sync
- embedded WhatsApp signup completion

Implemented bad-session probes:

- unknown opaque session token
- JWT-shaped invalid session token
- UUID-shaped invalid session token

All are required to fail with `401 Unauthorized` on protected APIs.

## Required coverage matrix

| Area | Cross-tenant IDOR | Authorization roles | Anonymous | Abuse/input | Status |
| --- | --- | --- | --- | --- | --- |
| contacts | partial | pending | partial | pending | active |
| lists | pending | pending | indirect | pending | next |
| segments | pending | pending | covered create | pending | next |
| templates | pending | pending | covered | pending | next |
| campaigns | covered existing ID routes | pending | covered | invalid session covered | active |
| campaign recipients | pending | pending | pending | pending | next |
| imports | covered existing ID routes | pending | covered | malformed upload pending | active |
| phone numbers | pending | pending | pending | pending | next |
| consent records | partial via contact actions | pending | partial | pending | active |
| suppressions | partial via contact actions | pending | partial | pending | active |
| analytics | pending | pending | pending | pending | future endpoint |
| settings | pending | pending | pending | pending | feature branch |
| members | pending | pending | pending | pending | feature branch |
| credentials | pending | pending | pending | secret leakage pending | next |
| admin endpoints | pending | platform-admin matrix pending | pending | pending | feature branch |

## Abuse suites to add as the corresponding endpoints land

- authorization matrix for Owner/Admin/Member/Viewer and platform administrators
- expired and revoked session behavior; malformed/unknown sessions are already covered
- CSRF on state-changing cookie-authenticated endpoints
- reflected/stored XSS payloads across user-controlled fields
- SQL injection payload corpus for search/filter/sort inputs
- oversized JSON, CSV, and multipart bodies
- malformed CSV and upload metadata
- invalid Meta webhook signatures beyond the existing signature unit tests
- webhook replay/idempotency behavior
- R2 organization-prefix isolation
- presigned URL method/content-type/expiry/key restrictions
- secret leakage in API responses, logs, build output, and error messages

## CI security gates

`.github/workflows/security.yml` runs independently from the main CI workflow and includes:

- `bun audit --audit-level=high` for dependency vulnerabilities
- Gitleaks repository-history secret scanning
- CodeQL JavaScript/TypeScript `security-extended` static analysis
- the isolated security Playwright suite against clean PostgreSQL and Valkey services

Container/image scanning is intentionally deferred until container images become part of the deployment path.

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

1. the response is `404` or `403`; and
2. the victim resource was not read, changed, queued, deleted, or leaked through the response.

Whenever an ID-bearing endpoint is added, its cross-tenant regression should be added in the same feature PR or immediately in this branch.
