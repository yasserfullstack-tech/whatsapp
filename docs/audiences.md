# Audience lists and segments

Campaign audiences are split into two concepts:

- **Lists** contain explicit contact memberships. CSV imports can add every valid row to a named list, including contacts that already existed in the workspace.
- **Segments** are saved dynamic filters. They can match all filters (AND) or any filter (OR) across list membership, display name, and E.164 phone predicates.

Every campaign stores its selected audience definition in `campaign_audiences` before the dispatcher is queued. The dispatcher evaluates that stored definition once while creating the immutable `campaign_recipients` snapshot. Editing a saved segment later does not mutate a campaign that has already launched.

## Eligibility safety

Audience filters can only narrow the baseline marketing-eligible population. The SQL predicate always requires:

- the contact belongs to the campaign organization;
- `opted_in = true`;
- `unsubscribed_at IS NULL`;
- no matching organization-scoped `suppression_list` row.

The preview/count endpoints and the worker use the same `buildEligibleAudiencePredicate` helper so the displayed count and snapshot semantics stay aligned.

Malformed persisted definitions fail closed to an impossible-match predicate. Historical campaigns created before audience records existed retain the old `all eligible contacts` behavior.

## CSV list imports

The browser still uploads CSV files directly to R2. `contact_imports.list_id` optionally points to a list. During each 1,000-row worker transaction:

1. new contacts are inserted with conflict protection;
2. all valid phone numbers in the batch are resolved back to contact IDs;
3. list memberships are inserted with `(list_id, contact_id)` conflict protection;
4. import progress is checkpointed.

This means an existing contact can be added to a new list without creating a duplicate contact row.

## Scale

Lists use indexed membership lookups. Segment preview/count queries execute in PostgreSQL and return only counts plus a ten-contact sample. Campaign launch never sends a contact array through the browser or Redis: the full selected audience is materialized with one `INSERT ... SELECT`, then the existing bounded BullMQ runway handles sending.
