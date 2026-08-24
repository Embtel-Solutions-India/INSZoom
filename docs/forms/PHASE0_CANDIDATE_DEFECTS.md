# Phase 0 Candidate Defects — Human Correctness Gate

This document is the input to the **human correctness gate** (§J.5 of the Phase 0 task spec): an
attorney or senior case manager must review these candidates and record, per item, whether it is
a confirmed defect (to fix in a later phase) or acceptable as part of the frozen baseline. Nothing
here has been fixed — Phase 0 is characterize-only. See `docs/forms/PHASE0_BASELINE.md` for the
pipeline inventory and `docs/forms/PHASE0_RUN_JOURNAL.md` for how these were found.

Produced by `Backend/src/modules/form-generation/tests/phase0/candidateDefectAnalyzer.js`
(read-only) run against the three committed golden snapshots
(`Backend/src/modules/form-generation/tests/golden/{h1b,l1a,k3}/snapshot.json`), cross-referenced
against each fixture's actual answer set and each crosswalk's fan-out shape to separate real
signal from expected noise (a checkbox in a mutually-exclusive group being absent because a
*sibling* checkbox matched instead is not a defect).

## Summary table

| Category | H-1B | L-1A | K-3 (I-130) |
|---|---|---|---|
| Widget-type shape mismatch (checkbox/radio fed free text, or vice versa) | 0 | 0 | 0 |
| Fan-out divergence (>1 mutually-exclusive checkbox simultaneously checked) | 0 | 0 | 0 |
| Crosswalk edges with no runtime value, total | 57 | 72 | 20 |
| ...of which: fixture never answered that source (expected, not a defect) | 30 | 61 | 10 |
| ...of which: fan-out group member, a sibling likely matched instead (expected) | 27 | 11 | 0 |
| **...of which: single-edge mapping, fixture DID answer it, still missing (HIGH CONFIDENCE)** | **0** | **0** | **10** |

**Headline finding: H-1B and L-1A have a clean bill of health on this axis** — every field the
fixture actually answered through a non-fan-out crosswalk edge reached the generated PDF, and no
checkbox/radio widget ever received a shape it can't represent correctly. K-3 (and, since `k3.js`
reuses `k1.js`'s `fieldCatalog` by reference, almost certainly K-1 too) has a **specific,
narrowly-scoped, high-confidence gap** — see P0-CD-001 below.

---

### [P0-CD-001] Petitioner and beneficiary core identity fields (name, DOB, birthplace) never reach the I-130 PDF for K-3, despite being answered
- Date: 2026-08-20
- Area / file(s): `Backend/src/modules/form-mapping/config/i130-k3-crosswalk.js` (10 affected
  edges), downstream of `Backend/src/modules/form-mapping/services/{FormMappingService,MappingResolver}.js`
- Category: unmapped-field (high confidence)
- Symptom: `Pt2Line4a_FamilyName`, `Pt2Line4b_GivenName`, `Pt2Line6_CityTownOfBirth`,
  `Pt2Line7_CountryofBirth`, `Pt2Line8_DateofBirth` (petitioner) and `Pt4Line4a_FamilyName`,
  `Pt4Line4b_GivenName`, `Pt4Line7_CityTownOfBirth`, `Pt4Line8_CountryOfBirth`,
  `Pt4Line9_DateOfBirth` (beneficiary) are all absent from `filledData`/the generated PDF, even
  though the corresponding questionnaire answers were submitted.
- Reproduction: `node src/scripts/phase0CaptureGolden.js k3` (or run
  `Backend/src/modules/form-generation/tests/phase0.golden.test.js`), then inspect
  `tests/golden/k3/snapshot.json`'s `pdfFieldValues` — none of the 10 fields above are present.
  Confirmed independently via a targeted diagnostic script that called
  `CanonicalDataService.build()` directly on a fresh K-3 case seeded with
  `Backend/src/test-utils/fixtures/k3-golden.js`'s exact answers.
- Root cause: **narrowed, not fully identified.** Confirmed the data IS correctly present at the
  canonical-data layer —
  `canonicalData.raw.questionnaireAnswers.petitioner_info_lastName.value === "Alvarez"` was
  verified present and correct immediately after `CanonicalDataService.build()`, for every one of
  the 10 affected source keys. The break is therefore downstream of canonical-data construction,
  inside `FormMappingService.mapTemplate` / `FormMappingService.isFieldVisible` /
  `MappingResolver.resolveMapping` / `MappingResolver.resolvePath` specifically for how these 10
  edges resolve against the I-130 template — not a crosswalk authoring typo (the source strings
  are correct; not visible in the sample fixture) and not a canonical-data population gap. A
  Phase 1+ investigation should start at `FormMappingService.isFieldVisible`/`resolveField` for
  these exact `fieldName`s on the I-130 template, not re-check canonical-data population.
- Causing action: unknown — not investigated via `git log -S`/`git blame` in Phase 0 (would cross
  from characterization into root-cause fixing scope).
- Impact: every K-3 petition generated today is missing the petitioner's and beneficiary's name,
  date of birth, and place of birth on the I-130 — arguably the single most safety-critical gap
  found in this session, since these are exactly the fields a case manager is least likely to
  catch as "obviously wrong" on a quick visual review (the fields are simply blank, not
  wrong-but-plausible). This is also the confirmed root of the pre-existing, already-failing
  `k1-golden-path.test.js` (`expected 'Whitfield', actual undefined`) and
  `k3-golden-path.test.js` (`expected true, actual false`) assertions documented in
  `PHASE0_RUN_JOURNAL.md` — not a new, separate defect, but this session is the first place all
  three symptoms (two failing tests + this candidate-defect scan) have been connected to one
  narrowed root cause.
- Phase-0 handling: characterized-only; captured in the K-3 golden fixture as-is (the golden
  fixture intentionally freezes CURRENT behavior, defect included, per §M of the task spec).
- Status: confirmed-defect (awaiting human) — **recommend attorney/case-manager confirmation is a
  formality here**; this is not a judgment call about correctness, it's fields being silently
  blank on a filed federal petition.
- Planned fix phase: Phase 1 or 2 (mapping-layer fix) — approach: instrument
  `FormMappingService.resolveField`/`isFieldVisible` for these 10 fieldIds on a K-3 case and
  compare against the equivalent H-1B/L-1A single-edge fields (which work correctly) to find the
  structural difference (e.g. a `condition` that's unintentionally always false, a `fieldId`
  mismatch between `template.formFields[].fieldId` and what the crosswalk assumes, or a page/part
  visibility rule specific to I-130 Part 2/Part 4).

### [P0-CD-002] Local storage-path env resolution collision (pre-existing, uncommitted, unrelated work)
- Date: 2026-08-20
- Area / file(s): `Backend/src/config/env.js`, `Backend/src/modules/uploads/storage.service.js`
  (both currently modified, uncommitted, part of an in-progress S3-migration effort — not part of
  this Phase 0 session's changes)
- Category: tooling/setup
- Symptom: `PDFRenderer.loadTemplatePdf` → `storageService.readBuffer` throws `ENOENT` looking for
  government template PDFs under `Backend/uploads/...` instead of `Backend/storage/...`.
- Reproduction: `npm run test:e2e` without `LOCAL_STORAGE_PATH` set, run
  `resume-ocr-to-i129-golden-path.test.js`.
- Root cause: the in-progress edits make `env.storage.localPath` fall back to `UPLOAD_DIR`
  (`./uploads`, previously only multer's transient-upload default) when `LOCAL_STORAGE_PATH` is
  unset; `.env` sets `UPLOAD_DIR` but not `LOCAL_STORAGE_PATH`, so permanent-storage reads now
  look in the wrong directory.
- Causing action: uncommitted local changes to `env.js`/`storage.service.js` (git status shows
  both modified; not yet committed at time of writing).
- Impact: blocks any PDF generation in this local dev environment until worked around; would
  presumably resolve itself once `LOCAL_STORAGE_PATH` is set in `.env` explicitly, or the
  in-progress S3-migration work lands with a corrected fallback.
- Phase-0 handling: neutralized-in-harness — `goldenHarness.js` and `phase0CaptureGolden.js` both
  set `process.env.LOCAL_STORAGE_PATH` explicitly before any pipeline module loads, so Phase 0's
  own artifacts are unaffected regardless of how the in-progress storage work resolves. No
  pipeline file was touched to work around this.
- Status: open (not this session's to fix — flagging for the storage-migration work's own review)
- Planned fix phase: n/a to this re-architecture effort; belongs to the concurrent S3-migration work.

### [P0-CD-003] `USCISMappingVersion` "exactly one active per template" has no DB-level guarantee
- Date: 2026-08-20
- Area / file(s): `Backend/src/models/USCISMappingVersion.js`,
  `Backend/src/modules/form-mapping/services/MappingGraphService.js:544-575`
- Category: invariant-risk
- Symptom: none observed — the current DB state is consistent (verified by this session's new
  invariant test). This is a latent risk, not an active bug.
- Reproduction: n/a (structural review, not a repro)
- Root cause: `MappingGraphService.activate()` retires the old active version and activates the
  new one as two separate, non-transactional writes
  (`USCISMappingVersion.updateMany(...)` then `mappingVersion.save()`); no partial-unique index
  enforces the invariant at the DB layer.
- Causing action: n/a — structural, present since the model/service were introduced.
- Impact: a crash or concurrent `activate()` call between the two writes could leave zero or
  multiple active mapping versions for one template, which `FormMappingService.loadMappingVersion`
  and the render pipeline assume never happens.
- Phase-0 handling: flagged-for-phase-2 (or whichever phase touches mapping-version activation);
  a Phase 0 invariant test (`Backend/src/modules/form-mapping/tests/phase0.invariants.test.js`)
  now asserts the current DB state is consistent, so any future regression is caught immediately
  even though the underlying non-transactional risk isn't fixed yet.
- Status: open
- Planned fix phase: whichever phase next touches `MappingGraphService.activate()` — wrap the
  retire+activate pair in a Mongo session/transaction, or add a partial unique index on
  `{template: 1}` filtered to `status: "active"`.

### [P0-CD-004] Manual-override checkbox/radio truthiness gap (generalizes an already-documented finding)
- Date: 2026-08-20
- Area / file(s): `Backend/src/modules/form-generation/services/PDFRenderer.js` (checkbox/radio
  `setFormField` branch), `Backend/src/modules/form-mapping/services/AutoFillService.js:overrideField`
- Category: type-mismatch
- Symptom: none reproduced in the three golden captures (the representative override in each was
  deliberately steered to a real crosswalk-mapped **text** field, per
  `goldenHarness.js`'s override-field selection, so a checkbox/radio override was never exercised
  by this session's captures). Already documented as a real, confirmed finding in
  `docs/forms/ARCHITECTURE.md` §4 ("Checkbox/radio field values reaching `CaseForm.filledData` via
  a manual override receive zero type coercion... a non-boolean truthy string... would render as
  checked").
- Reproduction: not re-reproduced this session; `ARCHITECTURE.md` already contains a confirmed
  repro from a prior session.
- Root cause: `AutoFillService.overrideField` writes whatever value the caller passes, with no
  type coercion; `PDFRenderer`'s checkbox/radio branch applies plain JS truthiness.
  `candidateDefectAnalyzer.js`'s `findWidgetShapeMismatches` (this session's new code) generalizes
  the detection so any future golden capture that DOES exercise a checkbox override will be
  flagged automatically.
- Causing action: unknown (pre-existing, documented in a prior forensic session per
  `ARCHITECTURE.md`'s dated entries).
- Impact: an attorney manually overriding a checkbox/radio field with anything other than a
  literal boolean or the crosswalk's own expected on-value risks silently checking a box that
  should be unchecked.
- Phase-0 handling: characterized-only, cross-referenced (not re-discovered) — flagged-for-phase-3
  or later (canonical write-back / field-type registry phases are the natural place to add
  type-aware coercion at the override boundary).
- Status: confirmed-defect (already confirmed in a prior session; carried forward here, not
  re-litigated)
- Planned fix phase: whichever phase introduces a field-type registry (task spec mentions this as
  a later-phase deliverable) — coerce/validate `overrideField`'s incoming value against the
  target widget's real type before persisting.

---

## What was checked and found clean

- **Widget-type shape mismatches**: 0 across all three visas — no checkbox/radio widget in any of
  the three golden captures received a long free-text value, and no text widget received a bare
  boolean.
- **Fan-out divergence**: 0 across all three visas — for every canonical source that fans out to
  multiple mutually-exclusive checkbox/radio pdfFields (15 sources for H-1B/L-1A, 4 each for K-1-
  shaped crosswalks per `PHASE0_BASELINE.md` §5), at most one sibling widget was ever
  simultaneously checked in the generated PDF.
- **H-1B and L-1A single-edge direct mappings**: every field the fixture answered through a
  non-fan-out crosswalk edge reached the generated PDF correctly (0 high-confidence gaps).

## Human correctness gate — sign-off (§J.5)

To be completed by an attorney or senior case manager:

| Item | Confirmed real defect? | Reviewer | Date |
|---|---|---|---|
| P0-CD-001 (K-3 identity fields) | ☐ yes ☐ no | | |
| P0-CD-002 (local storage path) | ☐ yes ☐ no (n/a - unrelated work) | | |
| P0-CD-003 (mapping-version race) | ☐ yes ☐ no | | |
| P0-CD-004 (checkbox truthiness) | ☐ yes ☐ no (already confirmed prior session) | | |
| Rest of each golden PDF acceptable as drift baseline | ☐ yes ☐ no | | |

**Phase 0 pauses at gate G5 until this table is completed and recorded** — see
`docs/forms/PHASE0_RUN_JOURNAL.md` for status.
