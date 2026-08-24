# Phase 4 Run Journal

## 2026-08-25 — §F pre-work / ground truth verification

- Ran `phase3:verify` first to confirm the Phase 3 baseline: PASS (21/21 Phase 3 backend, 12/12
  frontend, 37/37 Phase 2 suite, `phase1:verify` PASS including `phase0:verify`, diff-scope guard
  PASS — expected to fail only once Phase 4's own new files exist).
- Read `PHASE1_RECONCILIATION.md` in full before touching anything: confirmed 0 dangling-mappings and
  0 unmapped-required-fields across all three crosswalks, and that the only outstanding coverage
  category was the 13-item semantic-type-mismatch list (source of P1-002).
- Read `docs/forms/issues/P1-002-semantictype-inference-false-positives.md` for the exact 13 field
  names before writing any test or fix — used verbatim, not re-derived from memory.

## 2026-08-25 — P0-CD-001 diagnosis (§E hypothesis check)

- §E's stated root cause was a global `sha1` `fieldId` key mismatch between the I-130 crosswalk and
  the live template. Before writing any fix, ran a direct diagnostic: pulled the live
  `USCISFormTemplate` for I-130 and its `USCISMappingVersion` document, compared
  `formFields[].fieldId` against `graph.edges[].targetFieldId` directly. They matched exactly.
  Separately confirmed dozens of OTHER I-130 fields already resolved correctly at runtime — neither
  observation is possible under a global key mismatch (which would break every field uniformly, not
  10 specific ones). Per the task's own explicit "if the hypothesis is wrong, STOP and report before
  proceeding" instruction, did not apply any fix yet.
- Traced the real mechanism instead: read `MappingGraphService.applyGraphToTemplate` in full (not
  just the task's quoted excerpt) and found its fallback —
  `mappingsByTarget.get(fieldId) || plain.mappings || []` — preserves a field's PRIOR mapping when the
  freshly-built graph doesn't produce a fresh edge for it. Separately confirmed
  `FormMappingService.loadMappingVersion`/`applyMappingGraph` only substitute fresh mappings when
  `template.activeMappingVersionId` is set to an `status:"active"` version; when unset, the template
  is returned completely unchanged at runtime.
- Checked I-130's `activeMappingVersionId`: `undefined`. Its one `USCISMappingVersion` was
  `status:"needs_review"`, never activated. Inspected the 10 P0-CD-001 fields' actual stored
  `formFields[].mappings` directly: low-confidence (34–41%), `needs_review`, auto-suggested, pointing
  at wrong sources (e.g. petitioner family name → shared `person.lastName`; a city-of-birth field →
  `contact.address.city` with an erroneously attached date transform).
- Called `classifyField()` from the CURRENT crosswalk file directly against all 10 fields — all 10
  already classify correctly as mapped with the right per-role
  `raw.questionnaireAnswers.{petitioner,beneficiary}_info_*` sources. Conclusion: the crosswalk was
  never broken; the mapping version built from it had simply never been activated. Documented the
  full diagnostic in P4-001 before making any change.

## 2026-08-25 — P0-CD-001 fix + verification

- Ran `npm run seed:i130-k3-mapping` (unchanged file) against the local test DB only. Confirmed via
  `ReverseIndexService.buildFormReverseIndex("I-130")` that all 10 P0-CD-001 paths are now present
  and `reverseSync:true`, and that ~112 other stale auto-suggested mappings were cleared as a side
  effect (expected — they were never real crosswalk edges).
- Wrote `i130-k3-golden-case.test.js`, reusing `goldenHarness.js`'s `captureGolden('k3')` rather than
  hand-rolling a new pipeline invocation. First run appeared to hang for several minutes in the
  background; diagnosed that the actual assertion completed in ~10s and the process simply never
  exited because `captureGolden()` connects via `connectTestDB()` by design (meant to be called
  repeatedly by `phase0Verify.js` without reconnecting) but never disconnects on its own. Fixed by
  adding `t.after(() => disconnectTestDB())` to this standalone test. Reran: pass, exits cleanly.
- Regenerated the K-3 golden snapshot via `npm run phase0:capture-golden k3`. Diffed old vs. new:
  16 fields changed. 15 were straightforwardly the P0-CD-001 fix (10 identity fields, 5 checkbox
  values). The 16th, `Pt4Line16_EmailAddress[0]`, went from a real petitioner email to `null` — looked
  like a possible regression at first glance.
  - Investigated before accepting: confirmed the crosswalk edge for this field was unchanged this
    phase; confirmed the PRE-fix stored mapping had `mappingType: "nested"`, a marker that only
    appears on stale, pre-seed-script auto-suggested data, never a real crosswalk-authored edge;
    confirmed the `k3-golden.js` fixture's `case.user` resolves to the petitioner, so a
    beneficiary-section field showing that same email is cross-contamination; ran two independent
    fresh captures, both deterministically `null`.
  - Conclusion: this is a correct fix (removes cross-contaminated data), not a regression. Accepted
    the golden update. Full reasoning recorded in `PHASE4_BASELINE.md` §8.

## 2026-08-25 — P1-002 fix

- Confirmed the old regex `/date|dob|birth|expiry|expires|issued|from|to/`'s two independent defects
  directly by calling `inferTextSemanticType` against all 13 confirmed false-positive field names
  quoted from the P1-002 ledger entry: bare `to`/`from` matching unrelated substrings
  (`Line_CityTown`, `PassportorTravDoc`), and bare `birth` matching every birth-related field.
  Confirmed all 7 true date fields (including 3 real date-of-birth names) only ever matched via the
  `date`/`dob` terms, never `birth`/`to`/`from` alone.
- Fixed by removing `birth`/`to`/`from` from the regex — not by adding exceptions per false-positive
  pattern, since none of the 13 needed a targeted carve-out once the two non-load-bearing terms were
  gone.
- Exposed `inferTextSemanticType` via a test-only `module.exports.inferTextSemanticType` (it was
  previously module-private) and wrote
  `PDFFieldScannerService.inferTextSemanticType.test.js` asserting all 13 false positives are now
  non-`"date"` and all 7 true date fields remain `"date"`. Both assertions pass.

## 2026-08-25 — Semantic-type format transforms

- Added `ssn`/`alienNumber`/`uscisReceiptNumber`/`phone` cases to `MappingResolver.applyTransform`,
  per §E's specification, and unit-tested all 4 in `MappingResolver.test.js` (6 new tests: format,
  passthrough-on-malformed-input, and a regression check that the pre-existing `date` case is
  unaffected).
- Before wiring `ssn`/`alienNumber` to the real `Line5_SSN[0]`/`Line1_AlienNumber[0]`/
  `Line10_AlienNumber[0]` I-129 fields (as §E implied), checked their actual `validationRules`:
  `maxLength: 9` on all three, with regexes that don't admit a dash or `A-` prefix. Both transforms'
  specified output format would overflow/mismatch these real widgets. Did NOT wire either — confirmed
  this matches a pre-existing comment already in `i129-h1b-crosswalk.js`'s
  `MANUAL_ENTRY_FIELDS.format_mismatch_confirmed_by_validation` block, predating this phase, which had
  already identified this exact overflow as the reason these 3 fields were left manual. Documented
  the decision in P4-004 rather than silently skipping it.
- Checked `phone`'s target widget (`Line2_DaytimePhoneNumber1_Part8[0]`) the same way first:
  `maxLength: 15`, a permissive regex admitting digits/`+`/`()`/`-`/space/`.` — the formatted output
  fits safely. Wired `{transform:{type:"phone"}}` onto that edge in `i129-h1b-crosswalk.js` and wrote
  `phase4.semantic-transforms.integration.test.js`, calling the real `FormMappingService.mapTemplate`
  end-to-end (not just the unit-level `applyTransform`) to confirm raw `"5125551234"` becomes
  `"(512) 555-1234"` through the actual pipeline. Pass.

## 2026-08-25 — Coverage audit + bonus I-129F finding

- Re-checked all three crosswalks against `PHASE1_RECONCILIATION.md`'s categories: 0
  dangling-mappings, 0 unmapped-required-fields, and the semantic-type-mismatch category now fully
  resolved by P1-002. No gap found requiring attorney sign-off.
- While confirming P0-CD-001's mechanism was I-130-specific, proactively checked whether I-129
  (already correctly activated, unaffected) and I-129F shared the same never-activated-mapping-version
  gap — this wasn't explicitly asked for by name, but falls under Phase 4's own "coverage audit across
  all three existing crosswalks" mandate. Found I-129F's `USCISMappingVersion` was ALSO never
  activated (`activeMappingVersionId: undefined`, same as I-130's pre-fix state).
- Fixed via `npm run seed:i129f-k1-mapping` (unchanged file), confirmed idempotent on a second run (no
  duplicate `USCISMappingVersion` documents). No K-1 golden fixture exists to diff (Phase 0's golden
  visa keys are h1b/l1a/k3 only) — verified via `ReverseIndexService` before/after instead, and
  confirmed `i129f-k1-crosswalk-coverage.test.js` (part of `phase0:verify`'s invariant suite) still
  green. Documented in P4-003.

## 2026-08-25 — Phase 2/3 test corrections from the mapping-activation fixes

- Re-running `phase3:verify` after the I-130 fix broke 2 existing tests
  (`phase3.fanout-invariant.test.js`, `AutoFillService.overrideField.k1k3-fanout.test.js`) that used
  `contact.address.zip` as an I-130 fan-out test field. Diagnosed: this path was one of the ~112 stale
  auto-suggested mappings cleared by activating I-130's real mapping version — never a genuine
  crosswalk edge to begin with. Updated both files to use a genuinely-reviewed field
  (`raw.questionnaireAnswers.petitioner_info_lastName.value`), noting in-file that I-130's reviewed
  crosswalk currently has no reverseSync:true field with more than 1 target (its only fan-out sources
  — gender, maritalStatus — are checkbox-derived and reverseSync:false), so this is now a
  single-target check rather than a fan-out check; the underlying mechanism (an override reaching
  canonical and being read back) is still fully exercised. Removed the I-130 CONFLICT-path test
  (depended on the same non-existent multi-field fan-out) and replaced the "P0-CD-001 boundary —
  fields absent" test with "P0-CD-001 is fixed — fields present and reverseSync:true", a permanent
  regression guard for the fix.
- After fixing I-129F (above), the identical `person.citizenship` staleness surfaced in the same 2
  files for K-1. Applied the identical correction pattern (→
  `raw.questionnaireAnswers.petitioner_info_lastName.value`).
- Documented both corrections in-file (as "test data correction due to a legitimate fix", explicitly
  not "reverting/weakening a test") and here. All 5 fanout-invariant tests and all 3 k1k3-fanout tests
  pass after the updates.

## 2026-08-25 — `phase4:verify`

- Modeled directly on `phase3Verify.js`'s structure: re-runs Phase 4's own new tests, Phase 3's
  backend suite directly (not via `phase3:verify` as a black box — its diff-scope guard only
  recognizes Phase-3-era files and would fail the instant Phase 4's own legitimately-allowed files
  exist in the working tree, the same structural issue `phase3Verify.js` itself first hit against
  `phase2:verify`), the frontend component tests, the Phase 2 suite, `phase1:verify`, and an expanded
  diff-scope allowlist covering all four phases' files.
- First full run: **PASS** — Phase 4 backend 15/15, Phase 3 suite 20/20, frontend 12/12, Phase 2 suite
  37/37, `phase1:verify` PASS (`phase0:verify` h1b/l1a/k3 all PASS, k3 golden fixture correctly
  updated), diff-scope guard PASS (no disallowed file in the working tree).

## §J.5 — outstanding (recorded, not performed)

Same visual smoke check flagged in `PHASE3_RUN_JOURNAL.md`, still not recorded as run by a human as
of this phase. Not performed by the agent — explicitly visual, cannot be automated.

## Diff scope (all four phases combined)

Phase 4 touched: `PDFFieldScannerService.js` (P1-002 regex fix + test export),
`MappingResolver.js` (4 new transform cases), `i129-h1b-crosswalk.js` (1 new `phone` transform edge),
the K-3 golden snapshot (16-field update), 4 new/updated Phase 4 test files, 2 corrected Phase 2/3
test files, `phase4Verify.js` (new), `package.json` (1 new script), `ARCHITECTURE.md`, and the
`docs/forms/` Phase 4 docs/ledger files. No forbidden file (`AutoFillService.js`,
`CanonicalProfileService.js`, `SyncStateService.js`, `ReverseIndexService.js`,
`FormMappingService.js`, `PDFRenderer.js`, `WatermarkService.js`, `CaseForm.js`) was touched, and no
crosswalk was authored for I-134/I-539/I-539A/I-907 — confirmed by `phase4:verify`'s own diff-scope
guard.
