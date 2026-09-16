# Contact management

PR-018 completes the workspace contact-management surface without changing the consent model.

## Data model

`0013_contact-management.sql` is a custom migration because the new metadata and audit tables are intentionally accessed through parameterized SQL while the existing Drizzle contact/consent tables remain unchanged. The migration adds:

- `contact_custom_fields` — up to 20 application-validated key/value fields per contact.
- `contact_tags` — workspace-scoped contact tags.
- `contact_notes` — operator notes with actor attribution.
- `contact_activity_events` — non-consent contact activity history.
- `contact_merges` — append-only source-to-target merge records with before snapshots and actor attribution.
- `contact_import_mappings` — normalized CSV column mappings captured before upload is queued.

All tables carry `organization_id` and foreign keys back to workspace data. API mutations additionally scope every lookup by the authenticated workspace.

## Consent and suppression invariants

Manual creation never grants marketing consent. New contacts are created with `opted_in = false`.

Editing metadata never changes `phone_e164`, consent, or suppression. Phone is treated as an identity key; duplicate identities are consolidated through merge rather than by rewriting the number.

A merge does **not** transfer consent or suppression between phone numbers. Source contact rows remain in the database for consent/audit history, but `contact_merges` marks them inactive. `buildEligibleAudiencePredicate()` excludes merge sources from all future campaign audiences.

Bulk suppression reuses the same safety behavior as single-contact suppression: it writes the authoritative suppression list, turns off contact opt-in, records consent events, and skips pending/queued campaign recipients.

## Merge and deduplication

Duplicate review only suggests contacts whose normalized display names are identical. This is deliberately a candidate signal, not an automatic identity decision. The operator must choose a target explicitly.

When a merge is confirmed:

1. Each source-to-target link is written to `contact_merges` with source and target snapshots, actor, reason, and timestamp.
2. Tags and missing custom fields are copied to the target; existing target custom-field values win.
3. Notes are moved to the target.
4. Contact-list memberships are copied to the target.
5. Source contacts remain stored but become ineligible for campaign selection through the global audience safety predicate.
6. General contact activity records the merge on both source and target records.

## Import mapping

The browser reads only the CSV header row before upload and asks the operator to choose the phone and optional display-name columns. Up to 10 custom fields can be mapped using `field=CSV column` entries.

The presign API validates and normalizes mapping names, then persists them in `contact_import_mappings`. The worker checks the actual parsed header against the configured phone column and applies custom-field values only to newly inserted contacts. Existing queued imports with no mapping row continue to use the legacy phone/name aliases.

## Pagination and large contact lists

The contact API uses keyset pagination, not `OFFSET`. Results are ordered by `contacts.phone_e164`, and the cursor is the last returned phone number. The existing unique index `contacts_org_phone_uq (organization_id, phone_e164)` therefore supports the default large-list traversal without scanning an ever-growing offset.

The API caps a page at 100 rows (the UI requests 50). Search/status filters remain bounded by the same page size; if search volume later requires substring-search acceleration, a trigram/search index can be added independently without changing the cursor contract.

## Permission model

Read access follows normal workspace access. Every write endpoint requires `contacts.manage`, which allows owner/admin/member and denies viewer. Consent restoration remains separately gated by `contacts.restoreConsent` (owner/admin).

Mutation endpoints reject cross-workspace IDs because contact selection always includes `organization_id`. Bulk and merge requests also reject already-merged source contacts.

## Verification

Run the normal repository gates:

```bash
bun test
bun run typecheck
bun run db:verify
bun run build
```

Migration smoke verification now asserts the six PR-018 tables and all 14 committed migrations. The contact-management unit tests cover phone validation, metadata normalization, bulk request safety, and merge validation.
