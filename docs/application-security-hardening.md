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
- package-level storage prefix tests plus `tests/credential-encryption-rotation.test.ts` for credential encryption and key-rotation behavior.

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

`tests/credential-encryption-rotation.test.ts` exercises the cryptographic core of the current rotation procedure:

1. encrypt a credential with the old 32-byte AES key;
2. decrypt it with the old key;
3. re-encrypt the plaintext with a newly generated key;
4. verify the new ciphertext decrypts only with the new key and the old ciphertext does not decrypt with the new key.

This automated exercise does **not** authorize replacing `CREDENTIAL_ENCRYPTION_KEY` in production without a rotation plan. The persisted credential row now records which key encrypted it, so the previous key can stay decrypt-capable while every row is re-encrypted; removing the previous key before that re-encryption has completed can still make Meta credentials unrecoverable.

### Versioned key design

`credential_secrets.key_version` (nullable integer) records which key encrypted each row. A row with no version is read as version 1, so rows written before versioning keep decrypting with the original `CREDENTIAL_ENCRYPTION_KEY` and require no data migration.

The runtime key ring is built from the environment:

- `CREDENTIAL_ENCRYPTION_KEY` — the active key; new writes record `CREDENTIAL_ENCRYPTION_KEY_VERSION` (default 1);
- `CREDENTIAL_ENCRYPTION_KEY_PREVIOUS` — a decrypt-only predecessor retained during a rotation window, at the immediately preceding version.

Reads select the key that matches the persisted version. A version with no configured key fails closed with a clear error instead of guessing a key, so a WhatsApp connection moves to the existing reauthorization-required path rather than returning corrupted plaintext.

`bun run credentials:rotate` (optionally scoped to one organization) decrypts each row with its recorded key and rewrites it under the active version, updating `key_version`. It is idempotent and can be re-run or resumed; rows already at the active version are left untouched. The re-encryption runs in bounded transactions (`CREDENTIAL_ROTATION_BATCH_SIZE`, default 200 rows) that lock each batch with `SELECT ... FOR UPDATE` ordered by id, so a batch either commits every row it locked or rolls back leaving the table untouched, a concurrent rotation waits on the row lock instead of interleaving, and an interrupted run leaves every committed batch rotated and the rest still readable with the previous key. A full single transaction over the whole table is deliberately avoided: it would hold row locks for the entire rotation, so the bounded per-batch transaction is the safest variant. Coverage lives in `packages/credentials/src/index.test.ts` (round-trip, wrong key, version selection, legacy rows, rotation, key-version reporting) and `apps/worker/src/credential-rotation.integration.test.ts` (a real Postgres rotation that leaves every row readable with only the active key, a failed batch that rolls back, a concurrent rotation that blocks on the row lock, and the predecessor-key report flipping to safe after rotation).

`bun run credentials:key-versions` (optionally scoped to one organization) answers the question an operator must answer before dropping `CREDENTIAL_ENCRYPTION_KEY_PREVIOUS`: it counts stored rows per `key_version` (a missing version is reported as version 1), reports how many still reference a version other than the active one, and prints a `safeToRetirePreviousKey` conclusion. It exits non-zero while any row still references an older version, so it can gate the final step of the rotation runbook.

Not yet implemented: a separate `ciphertext_version` column (unnecessary while the AES-256-GCM ciphertext format is unchanged; add one before any format change so key lifecycle and format migration stay independent).

Emergency rotation after suspected key compromise requires treating all decryptable stored Meta access tokens as potentially exposed and coordinating token replacement/reauthorization, not only re-encryption.

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
- credential encryption key/ciphertext versioning: implemented — `credential_secrets.key_version` (nullable; a missing version reads as version 1), an environment key ring (`CREDENTIAL_ENCRYPTION_KEY`, `CREDENTIAL_ENCRYPTION_KEY_VERSION`, decrypt-only `CREDENTIAL_ENCRYPTION_KEY_PREVIOUS`), and an idempotent re-encryption routine (`bun run credentials:rotate`) covered by unit and Postgres integration tests;
- predecessor-key reference check: implemented — `summarizeKeyVersions` / `inspectStoredKeyVersions` in `@wa/credentials` and `bun run credentials:key-versions` count stored rows per key version, report how many still reference the predecessor, and conclude whether it is safe to retire; covered by unit tests and a Postgres integration test that flips the conclusion after a rotation;
- transactional credential rotation: implemented — re-encryption runs in bounded transactions that lock each batch with `SELECT ... FOR UPDATE`, so a batch commits or rolls back as a unit and a concurrent rotation cannot interleave; covered by a Postgres integration test that forces a batch failure and asserts nothing was committed, plus a test that a concurrent rotation blocks on the row lock;
- PostgreSQL RLS: decision documented as deferred with revisit criteria;
- privileged admin operations: review criteria and current control inventory documented;
- independent penetration test: **not complete in Git** and remains external evidence for issue #67;
- critical/high finding closure: cannot be completed until the independent assessment produces findings or a clean report.

Because the final two items require external evidence, PR-022 and issue #67 must remain open/uncompleted until that evidence exists, even if repository CI is green.
