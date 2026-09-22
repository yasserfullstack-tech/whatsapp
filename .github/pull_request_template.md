## Summary

<!-- What changed and why. -->

## Readiness tracking (issues #46–#67)

Readiness state lives in `docs/production-readiness-plan.md`; a tracking issue stays open until its Definition of Done **and** its evidence requirements are met. See the "Closing-keyword convention for readiness PRs" section of that plan.

- [ ] This PR does **not** complete a readiness tracking issue whose DoD still requires external evidence (production, legal, recovery, provider, capacity, operator delivery, or independent security).
- [ ] If it does not, this PR uses `Refs #N` / `Supports #N` — **never** `Closes #N` / `Fixes #N`.
- [ ] The PR body does not use a negated closing phrase such as `does not close #N`; use `keeps #N open` so GitHub cannot parse an accidental closing keyword.
- [ ] If it promotes a plan checkbox to `[x]`, the same change confirms the tracking issue can be closed and that evidence links are present on the issue.
- [ ] If it edits `docs/production-readiness-plan.md`, `bun infra/production/scripts/check-readiness-sync.ts` reports 0 mismatches.

## Verification

<!-- Tests run, CI links, and any sanitized evidence attached. -->
