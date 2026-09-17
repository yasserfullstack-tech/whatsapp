# Application security hardening

This document is the repository-side decision and evidence record for PR-022 / issue #67. It covers controls that can be reviewed and exercised in CI and deliberately keeps independent penetration testing as an external release-stage gate.

## Security regression baseline

The dedicated Security workflow runs dependency audit, secret scanning, CodeQL, and the Playwright security suite on pull requests. The browser security suite uses isolated test tenants and exercises authorization through the same HTTP surfaces used by the application.

Relevant regression suites include:

- `e2e/security/tenant-isolation.e2e.ts` for cross-tenant reads, writes, workspace-cookie forgery, export secrecy, role boundaries, upload signing, and session revocation;
- `e2e/security/idor-existence.e2e.ts` for existence-oracle resistance: a foreign campaign/import identifier must produce the same status and body as a nonexistent identifier;
- `e2e/security/auth-abuse.e2e.ts` for cross-site auth requests, account enumeration, password-reset throttling, redirect abuse, and oversized auth bodies;
- `e2e/security/query-abuse.e2e.ts` for SQL metacharacters and wildcard payloads through audience filters;
- `e2e/security/object-storage-isolation.e2e.ts` for foreign-tenant, traversal-like, duplicate-separator, backslash, and control-character object keys;
- `e2e/security/platform-admin*.e2e.ts` for workspace/platform-admin boundary checks;
- package-level security tests for storage prefix validation and credential encryption.

A security regression is not accepted merely because the UI hides an object. Tenant identity must participate in the database lookup/mutation predicate, foreign resources should normally be indistinguishable from absent resources, and object-storage keys must be independently checked against the authenticated tenant's expected prefix before signing or reading.

## Abuse and rate-limit coverage

Authentication abuse coverage intentionally uses different account identifiers during password-reset attempts so the test proves throttling cannot be bypassed by simply changing the submitted email. Sign-in/sign-up route limits remain configurable for deployment through `AUTH_SIGNIN_RATE_LIMIT_MAX` and `AUTH_SIGNUP_RATE_LIMIT_MAX`; the security suite keeps those high enough that tenant fixture creation does not consume the test budget while the password-reset abuse regression verifies an actual `429` response and retry metadata.

Application request-boundary and query-abuse tests complement rate limiting. Rate limiting is not treated as a substitute for bounded schemas, tenant predicates, authorization checks, request-size limits, idempotency, or provider-side backpressure.

## Object-storage hostile input

R2/S3 object keys are opaque strings, but application-generated keys are constrained to path-like tenant prefixes. `isObjectKeyWithinPrefix` therefore rejects:

- absolute-style keys;
- backslashes;
- ASCII control characters;
- empty, `.` or `..` path segments;
- malformed expected prefixes;
- keys equal to, rather than strictly below, the expected prefix;
- keys belonging to another tenant, job, or resource prefix.

The download E2E regression persists malformed object keys directly in the database before requesting a presigned download. This is intentional: it proves a corrupted or hostile persisted key cannot bypass the signing boundary even when normal write-time validation was skipped.

## Secret rotation

All production secrets remain owned by the deployment secret manager or host configuration; see `docs/secrets.md`. Rotation should use overlap whenever the external system permits it: create/activate the replacement, deploy it, verify the replacement is in use, then revoke the predecessor.

### Credential-encryption key: current exercise

`packages/credentials/src/index.test.ts` exercises the cryptographic core of the current rotation procedure:

1. encrypt a credential with the old 32-byte AES key;
2. decrypt it with the old key;
3. re-encrypt the plaintext with a newly generated key;
4. verify the new ciphertext decrypts only with the new key and the old ciphertext does not decrypt with the new key.

This automated exercise does **not** authorize replacing `CREDENTIAL_ENCRYPTION_KEY` in production without a database migration/backfill plan. The current persisted credential row does not record which key encrypted it, so removing the old key before all rows are re-encrypted can make Meta credentials unrecoverable.

### Versioned key/ciphertext design

A production rolling rotation should add explicit envelope metadata instead of relying on operator knowledge:

- add `credential_secrets.key_version` (opaque identifier such as `2026-09`) and `credential_secrets.ciphertext_version` (integer format version);
- configure a keyring containing the active key and one or more decrypt-only predecessor keys, rather than a single unversioned key;
- new writes use the active `key_version` and current `ciphertext_version`;
- reads select the exact key by persisted `key_version`; unknown versions fail closed and move the WhatsApp connection to the existing reauthorization-required path rather than guessing keys;
- a resumable, tenant-scoped backfill decrypts each old row with its recorded/legacy key and atomically rewrites it with the active key/version;
- metrics or a verification query prove no rows reference the predecessor key before that key is removed from the keyring;
- rollback keeps the predecessor key decrypt-capable until the new deployment and backfill have both been proven healthy.

For legacy rows created before version columns exist, the migration should assign a dedicated `legacy` key version representing the then-current `CREDENTIAL_ENCRYPTION_KEY`; operators must preserve that exact key until the backfill count reaches zero. Ciphertext-format changes must increment `ciphertext_version` independently from key rotation so cryptographic-format migration and key lifecycle are not conflated.

This design should be implemented before a routine production credential-encryption-key rotation is attempted. Emergency rotation after suspected key compromise requires treating all decryptable stored Meta access tokens as potentially exposed and coordinating token replacement/reauthorization, not only re-encryption.

## PostgreSQL RLS decision

**Decision: defer PostgreSQL row-level security for the current release; retain it as defense in depth, not as the primary tenant boundary.**

Rationale:

- current application authorization already carries organization identity into tenant-scoped query predicates and is covered by dedicated cross-tenant browser tests;
- the application currently uses shared pooled database credentials, so useful RLS would require a trustworthy transaction-local tenant context on every request/job rather than simply enabling policies;
- introducing session-scoped tenant state into a connection pool can create a new cross-tenant failure mode if state leaks between borrowers;
- workers and platform-admin operations legitimately cross tenant boundaries and would need explicit, separately reviewed bypass roles/policies;
- enabling partially designed RLS can create a false sense of isolation while operational paths continue to require broad database privileges.

RLS should be revisited if the database access layer gains transaction-local tenant context, if a dedicated tenant-scoped database role is introduced, before exposing direct database/reporting access, or if an independent assessment recommends it. A future rollout should start with representative high-risk tables, include forced-RLS tests using the same database role as production, and separately test worker/platform-admin bypass paths.

## Privileged administration review

The current platform-admin design remains acceptable for this release stage with the controls documented in `docs/platform-admin.md`:

- workspace roles never imply platform-admin access;
- platform-admin grants are explicit and revocable, bootstrap-by-email requires a verified email, and the normal grant/revoke path is audited;
- self-revocation is prevented in the supported admin action;
- organization suspension, user disable, membership changes, billing controls, queue retries, and limit changes are guarded by platform-admin authorization and write audit events;
- provider-managed billing is read-only to avoid local/provider state drift;
- queue retries are allowlisted; generic message-send retry and generic webhook retry are intentionally excluded because their durable state machines require specialized recovery;
- last-owner mutations are serialized before the owner-count check;
- audit export is bounded and itself audited;
- user impersonation is intentionally absent.

Review rule for future privileged operations: every new mutation must have a server-side platform-admin guard, narrowly validated input, an immutable audit event containing actor and target, deterministic failure behavior, and a security regression showing an ordinary workspace owner cannot invoke it. Operations that can cause external side effects or bypass tenant scope need an additional threat-model note in the same pull request.

## Independent security review / penetration test

Independent assessment is external evidence and is not satisfied by this repository PR or by CI. Before the release stage that requires the assessment:

1. define scope covering authentication/session handling, tenant isolation/IDOR, platform administration, Meta credential handling, object storage/presigned URLs, webhook endpoints, import/export paths, billing callbacks, and exposed production infrastructure;
2. provide a dedicated staging environment with production-equivalent security configuration and synthetic data;
3. require a report that records severity, reproduction evidence, affected surface, and remediation recommendation;
4. create remediation references for every finding and preserve a sanitized evidence copy outside the application repository if the report contains sensitive exploit details;
5. block the broader enterprise rollout on unresolved critical/high findings unless the accountable owner records a time-bounded formal acceptance with rationale and compensating controls;
6. retest remediated critical/high findings and attach the retest evidence to issue #67.

Do not place exploit credentials, customer data, private assessment details, raw tokens, or production secrets in GitHub issues or the repository. Use sanitized evidence and access-controlled report storage.

## PR-022 evidence status

Repository evidence provided by this hardening work:

- tenant-isolation / IDOR regression expansion: implemented in CI;
- abuse/rate-limit regressions: existing suite retained and documented as a release gate;
- hostile/malformed object-storage regression expansion: implemented in unit and browser security tests;
- secret rotation procedure: cryptographic re-encryption path exercised in unit tests; operational production rotation remains controlled by the runbook;
- credential encryption key/ciphertext versioning: design recorded here; runtime/schema implementation remains a prerequisite for routine rolling rotation;
- PostgreSQL RLS: decision documented as deferred with revisit criteria;
- privileged admin operations: review criteria and current control inventory documented;
- independent penetration test: **not complete in Git** and remains external evidence for issue #67;
- critical/high finding closure: cannot be completed until the independent assessment produces findings or a clean report.

Because the final two items require external evidence, PR-022 and issue #67 must remain open/uncompleted until that evidence exists, even if repository CI is green.
