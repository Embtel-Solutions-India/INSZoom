# Phase 2 Run Journal

## 2026-08-24 — §F pre-work / ground truth verification

- Confirmed §E ground truth against actual source: `CanonicalProfileService.rebuild`/`resolveConflict`,
  `AutoFillService.overrideField`/`mergeMappedFields`/`isReviewedOrManual`/`generate`, `MappingResolver`,
  `FormMappingService.loadTemplate`/`applyMappingGraph` — all matched as described.
- **Correction found:** `CaseForm.syncState` is a strictly-typed subdocument, not `Mixed` — a
  `syncState.fieldStates` addition (as originally sketched for a later §I.4) would be silently stripped by
  Mongoose without a schema change. Deferred to whenever §I.4 is actually built; not needed for §I.1–§I.3.
- **Blocking architectural gap found:** `CanonicalDataService.build()` unconditionally forces
  `CanonicalProfileService.rebuild()`, which fully recomputes `canonicalProfile.profile` from
  `CanonicalBuilderService.build()`'s raw candidates — a direct write to `canonicalProfile.profile` (as
  originally planned for `applyStaffEdit`) would be silently discarded the moment anything (including the
  fan-out this phase itself adds) triggers the next rebuild.
- Raised both this gap and the §J.1 precedence question to the user together, since resolving the gap
  depends on which precedence policy is chosen.

## 2026-08-24 — Decisions confirmed

- **Rebuild-durability fix:** re-apply `staff_edit_applied` history entries inside
  `CanonicalProfileService.rebuild()` — stays entirely within `CanonicalProfileService.js`.
- **§J.1:** Option A — staff always wins; a later conflicting update raises a conflict, never silently
  overwrites the staff correction.

## 2026-08-24 — §I.1 (`applyStaffEdit`) + §I.2 (`ReverseIndexService`)

- Implemented `applyStaffEdit`, `#collectStaffOverrides`/`#applyStaffOverrides` (private, so the public
  method-surface allowlist in `phase0.invariants.test.js` only grows by one), and wired `rebuild()` to use
  them.
- Implemented `ReverseIndexService` (`buildFormReverseIndex`, `buildReverseIndex`, `lookupSource`,
  `classifyReverseSync`).
- Smoke-tested both directly against the real seeded I-129 mapping graph before writing formal tests —
  confirmed `person.lastName` → exactly 3 fields (Phase 0 baseline), `person.fullName` →
  `reverseSync:false`.
- Wrote `CanonicalProfileService.applyStaffEdit.test.js` (7 tests) and `ReverseIndexService.test.js` (6
  tests) — all green on first correct run (one iteration to fix test actor role for `canAccessCase`, one
  iteration to make the concurrency test deterministic instead of racing on real Promise timing).
- Updated `phase0.invariants.test.js`'s method-surface allowlist to add `applyStaffEdit`.
- `phase0:verify` and `phase1:verify` both green — zero regressions, golden PDFs unmoved.

## 2026-08-24 — §I.3 (`overrideField` reroute)

- Inspected every caller of `overrideField` before changing it: `AutoFillController.overrideField` (HTTP
  handler), `interactiveFormReviewService.saveField`, `goldenHarness.js` (Phase 0's own golden-fixture
  capture — picks a real mapped field, so its override call now legitimately exercises the reverseSync
  path). Confirmed none depend on `canonicalProfile` staying untouched, and confirmed the golden-capture
  timing (PDF/filledData snapshots happen *before* the override call) makes the fan-out side effect safe.
- Verified the field the existing Phase 0 invariant test used (`Line8a_StreetNumberName`, mapped to
  `contact.address.line1`) is itself `reverseSync:true` — confirming that invariant test's premise was
  now field-dependent, not universally true, exactly as anticipated.
- Implemented the reroute: canonical write (`applyStaffEdit`) happens *before* the CaseForm write, so a
  stale/conflicting save never half-applies; the CaseForm write itself is untouched in shape; fan-out
  (`generate(..., {regenerate:true})`) only runs when the canonical value actually changed.
- **Bug found and fixed during testing (P2-002):** TEST 5 (idempotency) failed on first run — a resubmitted
  identical value still bumped the version. Root cause: `applyStaffEdit`'s no-op diff compared the live
  Mongoose-read `previous` (containing real ObjectId instances once any real rebuild had populated the
  profile) against a JSON-round-tripped `nextProfile` clone — `CanonicalComparisonService.flatten()`
  recurses into a live ObjectId as a plain object but treats its string clone as an atomic leaf, fabricating
  ~26 phantom diffs. Fixed by diffing two independently round-tripped clones against each other, entirely
  within `applyStaffEdit` — `CanonicalComparisonService.js` itself untouched.
- Replaced (not deleted) the Phase 0 invariant test that assumed `overrideField` never touches
  `canonicalProfile`, with two tests: one confirming the new deliberate behavior for a reverseSync-eligible
  field, one confirming the original invariant still holds for a derived/composite or form-only field.
- Wrote `AutoFillService.overrideField.reverseSync.test.js` (TEST 1–9) — all green after the P2-002 fix.
- Ran the full canonical + form-mapping targeted test set (75 subtests, excluding the one file that
  connects to the real `MONGODB_URI` by design) — all green. Ran that one file (`h1-i129-mapping.test.js`)
  separately with `MONGODB_URI` forced to the local test DB — 7/8 pass; the 1 failure
  (`employer_foreignCompany_*` fields unresolved) is pre-existing and unrelated: the golden fixture
  (`i129-h1b-golden-case.js`) has zero answers for those keys, confirmed by direct grep, and the failure is
  reproducible independent of any Phase 2 change. Not part of `phase0:verify`'s test list.
- `phase0:verify` and `phase1:verify` re-run and green after the reroute (26/26 invariant+coverage tests,
  golden PDFs unmoved).
- Updated `docs/forms/ARCHITECTURE.md`'s Edit/save dependency map and added a Phase 2 contract summary
  under "Forms-specific rules". Wrote `docs/forms/PHASE2_BASELINE.md`, `P2-001`, and `P2-002` ledger
  entries.

## 2026-08-25 — §I.4 (`SyncStateService`), §I.5 (K-1/K-3 fan-out), §I.6 (`phase2:verify`)

- Before writing anything, checked whether `phase0:verify`'s golden-snapshot mechanism could be broken
  by adding a new key to `sourceAttribution` (§I.4's storage location). Confirmed it can't:
  `goldenHarness.js`'s `overrideExample.sourceAttribution` is written into the committed snapshot JSON
  but never diffed by `phase0Verify.js`'s `verifyVisa()` (which only hash-compares
  `pdfFieldValuesHash`/`pdfSnapshotHash`, both captured *before* the override call), and
  `phase0:verify` never rewrites the committed golden files (only `phase0:capture-golden` does, and
  only deliberately). Verified this holds after implementing, not just assumed.
- Implemented `SyncStateService` (`SYNCED`/`MANUAL_OVERRIDE`/`CONFLICT`, stored in
  `sourceAttribution[pdfField].syncState`) and wired it into `overrideField`: the edited field always
  becomes `MANUAL_OVERRIDE`; after a reverseSync fan-out, untouched siblings become `SYNCED`, and any
  sibling with its own pre-existing independent manual override becomes `CONFLICT` (value preserved,
  `CONFLICT_DETECTED` audit entry pushed) instead of being silently resynced.
- Wrote `SyncStateService.test.js` (5 unit tests, no DB) and extended
  `AutoFillService.overrideField.reverseSync.test.js` with TEST 10/11 for the two sync-state paths.
  **Test-setup bug caught and fixed:** TEST 11 first failed because the test itself mutated
  `caseForm.fieldValues`/`filledData` in place instead of cloning + `.set()`-ing (the exact Mixed-field
  gotcha `AutoFillService.overrideField`'s own code comments document) — Mongoose never persisted the
  in-place mutation, so the "pre-existing override" never actually existed in the DB. Not a bug in the
  implementation; fixed the test.
- Investigated real fan-out sources for I-129F (K-1) and I-130 (K-3) via `ReverseIndexService` before
  writing §I.5's tests, rather than assuming shapes. Found `person.citizenship` (I-129F, 2-way) and
  `contact.address.zip` (I-130, 11-way) as clean, small, non-date examples.
  **Found and worked around an unrelated pre-existing issue:** the first K-3 fan-out test used
  `person.dob` (2-way) and failed by exactly one day (`05/14/1985` vs `05/15/1985`) - traced to
  `MappingResolver.formatDate`'s local-time-parse-then-UTC-extract round trip, a timezone-dependent
  characteristic of a file Phase 2 does not touch. Switched the test to `contact.address.zip` (plain
  string, no transform) rather than fixing or working around `MappingResolver.js`.
- Confirmed the 10 P0-CD-001 source paths (`raw.questionnaireAnswers.{petitioner,beneficiary}_info_*`)
  are absent from `ReverseIndexService`'s I-130 reverse index - independent confirmation, from a
  different code path than P0's own investigation, that the defect is upstream of/at graph compilation,
  not merely a runtime-resolution symptom. Also noticed, while investigating, that `person.dob` fans
  out to 2 fieldIds whose names match 2 of the P0-CD-001 list (`Pt2Line8_DateofBirth`,
  `Pt4Line9_DateOfBirth`) via an older, beneficiary-scoped canonical path - suggesting a stale
  `USCISMappingVersion` seed (crosswalk edited after the last mapping seed run) rather than confirming
  the resolver-level cause P0-CD-001 originally narrowed to. Recorded as a note for Phase 4 in the
  test's own comment; did not re-seed or investigate further (out of scope for Phase 2).
- Wrote `Backend/src/scripts/phase2Verify.js` (`npm run phase2:verify`): runs the Phase 2 test suite +
  `phase1:verify` (which runs `phase0:verify`) + a diff-scope guard + a per-form fan-out summary.
  **Deviated from the task spec's exact diff-guard mechanism** (`git diff` against `main` via
  merge-base) because this branch has substantial unrelated history already committed and diverged
  from `main` - that diff would list all of it, not just Phase 2's slice. Used `git status --porcelain`
  (the uncommitted working tree) instead, documented in the script's own header comment and in
  `PHASE2_BASELINE.md` §6.
- Full run: `phase2:verify` → PASS (37/37 Phase 2 tests, `phase1:verify` PASS, diff-scope guard PASS,
  fan-out summary printed for all 3 forms).

## Diff scope (all sessions combined)

`CanonicalProfileService.js`, `AutoFillService.js`, `package.json`, `ReverseIndexService.js` (new),
`SyncStateService.js` (new), `phase2Verify.js` (new), 6 new test files, 1 updated test file
(`phase0.invariants.test.js`), `ARCHITECTURE.md`, this journal, `PHASE2_BASELINE.md`, 2 ledger entries.
No crosswalk file, `CaseForm.js` schema, `MappingResolver.js`, `PDFRenderer.js`, or `WatermarkService.js`
touched at any point.
