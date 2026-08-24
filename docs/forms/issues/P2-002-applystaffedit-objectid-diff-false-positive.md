### [P2-002] `applyStaffEdit`'s idempotency check produced false positives once the profile contains ObjectIds
- Date: 2026-08-24
- Area / file(s): `Backend/src/modules/canonical/services/CanonicalProfileService.js` (`applyStaffEdit`), `Backend/src/modules/canonical/services/CanonicalComparisonService.js` (`flatten`, unmodified - see root cause)
- Category: sync-state
- Symptom: resubmitting an unchanged value through `applyStaffEdit` (directly, or via
  `AutoFillService.overrideField`'s §I.3 fan-out, which itself triggers a `rebuild()`) bumped
  `canonicalProfile.version` and appended a duplicate `staff_edit_applied` history entry instead of
  being treated as a no-op - confirmed via `AutoFillService.overrideField.reverseSync.test.js`
  TEST 5 (idempotency), which failed with `5 !== 3` (an unexpected extra version bump) before this
  fix.
- Reproduction: seed a case, call `overrideField` once (canonical version bumps from a rebuild
  triggered by the fan-out), then call `applyStaffEdit` again with the identical `{path, value}` -
  the second call did not short-circuit.
- Root cause: `applyStaffEdit` computed its no-op diff as
  `CanonicalComparisonService.compare(previous, nextProfile)`, where `previous` was the LIVE
  Mongoose-read profile (containing real `ObjectId`/`Date` instances written by any prior
  `CanonicalBuilderService.build()` rebuild - e.g. `profile.case.id`, `profile.metadata.caseId`)
  and `nextProfile` was a `JSON.parse(JSON.stringify(previous))` clone (where those same ObjectIds
  serialize to plain hex strings). `CanonicalComparisonService.flatten()` recurses into a live
  `ObjectId` as if it were a plain nested object (it only special-cases `Date`), producing paths
  like `case.id.buffer.0..11`, but treats the string clone as an atomic leaf at `case.id` - an
  asymmetry that fabricates ~26 phantom "removed"/"added" diff entries on every call once any real
  `CanonicalBuilderService` rebuild has ever populated the profile, defeating the no-op
  short-circuit for any profile beyond a trivial hand-built test fixture.
- Causing action: introduced this session, in this phase's own `applyStaffEdit` implementation
  (§I.1) - caught before merge by writing TEST 5 against a profile that had gone through a real
  fan-out-triggered rebuild, rather than only the simpler hand-built fixtures used in
  `CanonicalProfileService.applyStaffEdit.test.js`'s own I.1-era test suite (which never exercised
  a real `CanonicalBuilderService.build()` output and so never surfaced this).
- Impact: would have caused every idempotent re-save (a common UI pattern - e.g. a form
  auto-saving on blur even when the field wasn't actually edited) to spuriously grow
  `canonicalHistory` and bump `canonicalProfile.version` indefinitely.
- Phase-2 handling: **fixed in phase.** `applyStaffEdit` now diffs two independently
  JSON-round-tripped clones of `previous` against each other (`normalizedPrevious` vs
  `nextProfile`) instead of the live value against one clone - both sides go through the same
  ObjectId/Date-to-string normalization, so the comparison is symmetric.
  `CanonicalComparisonService.js` itself was left unmodified (per Phase 2's "reuse without
  modification" scope) - the fix is entirely local to `applyStaffEdit`.
- Status: resolved
- Planned fix phase: n/a (fixed here). Note for a later phase: `CanonicalProfileService.rebuild()`
  and `resolveConflict()` still diff a live `previous` against a round-tripped `next` the same way
  `applyStaffEdit` used to - harmless today (their `changes` value is informational only, not used
  for a no-op decision), but worth normalizing consistently if either method ever gains its own
  idempotency short-circuit.
