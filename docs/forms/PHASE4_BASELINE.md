# Phase 4 Baseline — Mapping Accuracy, P0-CD-001 Fix, Semantic-Type Transforms & Coverage

Covers all of Phase 4's planned work (§I.1–§I.4 equivalent: P0-CD-001, P1-002, semantic transforms,
coverage audit). `AutoFillService.js`, `CanonicalProfileService.js`, `SyncStateService.js`,
`ReverseIndexService.js`, `FormMappingService.js`, `PDFRenderer.js`, `WatermarkService.js`, and
`CaseForm.js` were **not modified** — confirmed by `phase4:verify`'s own diff-scope guard, which
fails the whole gate if any of those appear in the working tree. No crosswalk was authored for
I-134/I-539/I-539A/I-907 (would require attorney sign-off, out of scope).

## 1. Ground-truth corrections found before writing code (§F/§E)

- **§E's P0-CD-001 root-cause hypothesis (a global `sha1` `fieldId` key mismatch between the
  crosswalk and the template) was wrong.** Verified directly: the live I-130 template's
  `formFields[].fieldId` values matched the stored `USCISMappingVersion.graph.edges[].targetFieldId`
  values exactly, and dozens of OTHER I-130 fields already resolved correctly at runtime — neither
  is possible under a global key mismatch, which would break every field uniformly. Per the task's
  own "if the hypothesis is wrong, STOP and diagnose before proceeding" instruction, did not apply
  any fix until the real mechanism was found (see §2 below).
- **§E's proposed `ssn`/`alienNumber` USCIS-citation formats (`xxx-xx-xxxx`, `A-xxxxxxxxx`) overflow
  the real I-129 widgets' own `validationRules`** (`maxLength: 9` on all three affected fields, with
  regexes that don't admit the extra dash/prefix characters). Implemented both transforms
  general-purpose and unit-tested, but did not wire either to `Line5_SSN[0]`/`Line1_AlienNumber[0]`/
  `Line10_AlienNumber[0]` — see P4-004.
- **`PHASE1_RECONCILIATION.md`'s own coverage categories were re-verified, not re-derived from
  scratch** — confirmed 0 dangling-mappings and 0 unmapped-required-fields still hold for all three
  crosswalks, and that the 13-item semantic-type-mismatch category was the only outstanding gap
  P1-002 needed to close.

## 2. P0-CD-001 — real root cause and fix

`USCISFormTemplate.formFields[].mappings` is written directly onto the template document at seed
time by `MappingGraphService.applyGraphToTemplate`, which falls back to a field's PRIOR mapping
whenever the freshly-built graph doesn't produce a fresh edge for it:
`mappingsByTarget.get(fieldId) || plain.mappings || []`. Separately, `FormMappingService.
applyMappingGraph` (used at runtime) only substitutes fresh, crosswalk-derived mappings when
`template.activeMappingVersionId` is set and points at a `status:"active"` `USCISMappingVersion` —
when unset, it returns the template unchanged, so runtime resolution uses whatever is already baked
onto `formFields[].mappings`.

I-130's `activeMappingVersionId` was `undefined`; its one `USCISMappingVersion` document had
`status:"needs_review"`, never `"active"`. For the 10 P0-CD-001 identity fields specifically, the
stale baked-in `formFields[].mappings` were low-confidence (34–41%), `needs_review`-status,
auto-suggested mappings pointing at semantically wrong sources (e.g. the petitioner's family-name
field mapped to a single shared, beneficiary-scoped `person.lastName`; a beneficiary email field
silently carrying the PETITIONER's email via a stale `contact.email` mapping). `classifyField()` in
the current crosswalk already correctly classified all 10 fields as mapped, with the right per-role
`raw.questionnaireAnswers.{petitioner,beneficiary}_info_*` sources — the crosswalk was never broken;
the mapping version built from it had simply never been activated.

**Fix:** ran `npm run seed:i130-k3-mapping` (unchanged file) against the test DB. This both fills the
10 P0-CD-001 fields correctly and clears ~112 other stale auto-suggested I-130 mappings, since
runtime resolution now uses a genuinely active mapping version derived from only the 33 reviewed
`MAPPED_EDGES`. Full ledger: `docs/forms/issues/P4-001-p0cd001-real-root-cause-unactivated-mapping-version.md`.

**Verification:** new golden-path test `i130-k3-golden-case.test.js`, reusing `goldenHarness.js`'s
`captureGolden('k3')` (real seed → `AutoFillService.generate` → `PDFGenerationService.generate` →
pdf-lib byte read), asserting all 10 fields against the real generated PDF bytes. Pass.

## 3. P1-002 — semantic-type false positives

`inferTextSemanticType`'s old regex `/date|dob|birth|expiry|expires|issued|from|to/` had two
independent defects: bare `to`/`from` matched as unanchored substrings inside unrelated field names
(`Line_CityTown`, `PassportorTravDoc`), and bare `birth` matched every birth-related field, not only
date-of-birth. Fixed by removing `birth`/`to`/`from` entirely — no confirmed true date field in this
codebase depends on those terms; every true date-of-birth field name already contains `date`. Verified
against all 13 confirmed false positives (now correctly non-`"date"`) and 7 confirmed true date
fields (still correctly `"date"`) in `PDFFieldScannerService.inferTextSemanticType.test.js`. Full
ledger: `docs/forms/issues/P4-002-p1002-regex-fix.md`.

Does not retroactively fix already-imported templates' stored `semanticType` values — those are set
once at import time.

## 4. Semantic-type format transforms

`MappingResolver.applyTransform` gained 4 new cases:

| Transform | Behavior | Wired to a real edge? |
|---|---|---|
| `phone` | 10-digit (or 11-digit with leading `1`) → `(xxx) xxx-xxxx`; passthrough otherwise | **Yes** — `i129-h1b-crosswalk.js`'s `Line2_DaytimePhoneNumber1_Part8[0]` |
| `ssn` | Clean 9-digit → `xxx-xx-xxxx`; passthrough otherwise | No — see below |
| `alienNumber` | Digits → `A-xxxxxxxxx` (zero-padded to 9); passthrough otherwise | No — see below |
| `uscisReceiptNumber` | Passthrough | No (no confirmed real edge needing it this phase) |

`ssn`/`alienNumber` were not wired to the real `Line5_SSN[0]`/`Line1_AlienNumber[0]`/
`Line10_AlienNumber[0]` fields: those widgets' own `validationRules` (`maxLength: 9`, regexes with no
room for a dash/prefix) would reject or truncate the formatted output. These fields remain
`MANUAL_ENTRY_FIELDS.format_mismatch_confirmed_by_validation`, unchanged from before this phase. Full
ledger: `docs/forms/issues/P4-004-ssn-alienNumber-transform-widget-format-mismatch.md`.

`phone` IS wired, after confirming `Line2_DaytimePhoneNumber1_Part8[0]`'s real `validationRules`
(`maxLength: 15`, a permissive regex) accommodate the formatted output. Verified end-to-end (real
`FormMappingService.mapTemplate` call, raw `"5125551234"` → `"(512) 555-1234"`) in
`phase4.semantic-transforms.integration.test.js`, not just at the unit level.

All 4 transforms are unit-tested for the true-date-not-mistakenly-touched case too (a
`{type:"date"}` mapping run through the same resolver is unaffected by the new cases).

## 5. Coverage audit (§I.4)

Re-checked `PHASE1_RECONCILIATION.md`'s categories against the current (post-fix) state of all three
crosswalks:

| Category | I-129 | I-129F | I-130 |
|---|---|---|---|
| Dangling mappings | 0 | 0 | 0 |
| Unmapped required fields | 0 | 0 | 0 |
| Semantic-type mismatch | 0 (was N/A) | 0 (was N/A) | 0 (was 13, now fixed by P1-002) |

No gap in this audit requires attorney review — the 13-item mismatch category is a scanner
classification defect (P1-002), not a crosswalk authoring gap. I-134/I-539/I-539A/I-907 remain
entirely unmapped by design; authoring crosswalks for them is explicitly out of Phase 4's scope and
was not attempted.

## 6. Bonus finding — I-129F had the identical P0-CD-001 defect class

While auditing all three crosswalks for the same never-activated-mapping-version gap (not limited to
I-130), found I-129F's `USCISMappingVersion` was ALSO never activated — same mechanism, same silent
failure mode. Fixed via `npm run seed:i129f-k1-mapping` (unchanged file), confirmed idempotent. No
K-1 golden PDF fixture exists (Phase 0's golden visa keys are h1b/l1a/k3 only), so verified via
`ReverseIndexService.buildFormReverseIndex` before/after instead. Full ledger:
`docs/forms/issues/P4-003-i129f-same-defect-class-found-and-fixed.md`.

## 7. Golden fixture update — K-3 snapshot

Regenerated `Backend/src/modules/form-generation/tests/golden/k3/snapshot.json` via
`npm run phase0:capture-golden k3` after the I-130 mapping-activation fix. 16 fields changed:

| Field | Old | New | Cause |
|---|---|---|---|
| `Pt2Line4a_FamilyName[0]` (petitioner) | `null` | correct last name | P0-CD-001 fix |
| `Pt2Line4b_GivenName[0]` (petitioner) | `null` | correct first name | P0-CD-001 fix |
| `Pt2Line6_CityTownOfBirth[0]` (petitioner) | `null` | correct city | P0-CD-001 fix |
| `Pt2Line7_CountryofBirth[0]` (petitioner) | `null` | correct country | P0-CD-001 fix |
| `Pt2Line8_DateofBirth[0]` (petitioner) | `null` | `02/19/1982` | P0-CD-001 fix |
| `Pt4Line4a_FamilyName[0]` (beneficiary) | `null` | correct last name | P0-CD-001 fix |
| `Pt4Line4b_GivenName[0]` (beneficiary) | `null` | correct first name | P0-CD-001 fix |
| `Pt4Line7_CityTownOfBirth[0]` (beneficiary) | `null` | correct city | P0-CD-001 fix |
| `Pt4Line8_CountryOfBirth[0]` (beneficiary) | `null` | correct country | P0-CD-001 fix |
| `Pt4Line9_DateOfBirth[0]` (beneficiary) | `null` | `06/05/1989` | P0-CD-001 fix |
| 5 gender/marital-status checkboxes | `false` | `true` | Cleared stale auto-suggested mappings exposed correct checkbox-derived values once the active version took over |
| `Pt4Line16_EmailAddress[0]` (beneficiary section) | real petitioner email | `null` | Cleared a stale `contact.email` mapping that had been cross-contaminating a beneficiary-section field with the PETITIONER's email — confirmed a fix, not a regression (see §8) |

## 8. Investigation: was the email field change a regression?

`Pt4Line16_EmailAddress[0]` going from a real email value to `null` initially looked suspicious given
the task's own explicit rule against accepting a golden update that silently hides a real regression.
Investigated from multiple angles before accepting it:
- The crosswalk's own mapping edge for this field was unchanged by this phase.
- The pre-fix stored mapping had `mappingType: "nested"`, which only appears on pre-seed-script,
  auto-suggested data — never on a genuine crosswalk-authored edge — confirming it was stale.
- The `k3-golden.js` fixture's `case.user` (the account context the seed uses) resolves to the
  petitioner, so a beneficiary-section field showing that same email is cross-contamination, not a
  legitimate shared value.
- Two independent fresh captures both deterministically produced `null` for this field.

Conclusion: correct fix (removes cross-contaminated data), not a regression. Documented at the time
in `docs/forms/PHASE4_RUN_JOURNAL.md`.

## 9. Phase 2/3 test corrections caused by the mapping-activation fixes

Two existing tests (across two files, covering both the I-129F and I-130 fixes) had unknowingly
depended on stale, non-crosswalk-authored mappings — cleared as a side effect of activating each
form's mapping version:
- `phase3.fanout-invariant.test.js`: I-129F's `person.citizenship` → `raw.questionnaireAnswers.
  petitioner_info_lastName.value`; I-130's `contact.address.zip` → the same field (single-target, not
  fan-out — I-130's reviewed crosswalk has no reverseSync:true multi-field fan-out source). The
  I-130 CONFLICT-path test (which depended on that same fan-out) was removed for the same reason; the
  I-130 "P0-CD-001 boundary — fields absent" test was replaced with a "P0-CD-001 is fixed — fields
  present" permanent regression guard.
- `AutoFillService.overrideField.k1k3-fanout.test.js`: identical corrections for K-1/K-3.

These are test-data corrections caused by a legitimate underlying fix, not a weakening of test
coverage — documented inline in both files and in `docs/forms/PHASE4_RUN_JOURNAL.md`.

## 10. `phase4:verify`

`Backend/src/scripts/phase4Verify.js`. Runs: Phase 4's own backend test suite (P0-CD-001 golden-path,
P1-002 scanner regex, MappingResolver transform unit tests, phone-transform integration test), Phase
3's own backend suite (re-run directly — two of its files were legitimately edited this phase), the
frontend component tests, the Phase 2 test suite, `phase1:verify` (which runs `phase0:verify`), and a
diff-scope guard covering all four phases' allowed files.

**Deviation from the phase3:verify pattern, same rationale carried forward:** does not call
`phase3:verify` as a black box — its own diff-scope guard only recognizes Phase-3-era files and would
fail the instant Phase 4's own legitimately-allowed files exist in the working tree. `phase4Verify.js`
re-runs Phase 3's test suite directly and is itself the authoritative combined-state check.

## 11. Test coverage summary

| Suite | Result |
|---|---|
| `PDFFieldScannerService.inferTextSemanticType.test.js` | 2/2 pass |
| `MappingResolver.test.js` (11 total, 6 new this phase) | 11/11 pass |
| `phase4.semantic-transforms.integration.test.js` | 1/1 pass |
| `i130-k3-golden-case.test.js` | 1/1 pass |
| `phase3.fanout-invariant.test.js` (updated) | 5/5 pass |
| `AutoFillService.overrideField.k1k3-fanout.test.js` (updated) | 3/3 pass |

`phase4:verify`: **PASS** — Phase 4 backend suite 15/15, Phase 3 suite 20/20, frontend 12/12, Phase 2
suite 37/37, `phase1:verify` PASS (including `phase0:verify` — h1b/l1a/k3 all PASS, k3 golden fixture
correctly updated), diff-scope guard PASS.

## 12. §J — human-only gates

- **Visual smoke check** — not performed by the agent; explicitly visual, cannot be automated. Same
  outstanding item as Phase 3's own §J.5 (still not recorded as run by a human as of this phase).
- **Attorney sign-off for I-134/I-539/I-539A/I-907 crosswalks** — not applicable this phase; no
  crosswalk was authored for these 4 forms, per explicit scope.
- **`docs/forms/PHASE4_ATTORNEY_REVIEW.md`** — not created. The coverage audit (§5) found no
  unresolved gap in the three EXISTING crosswalks that requires attorney sign-off; the only
  attorney-gated item (authoring the 4 new crosswalks) was correctly not attempted.

## 13. Known gaps

- **P4-004** — `ssn`/`alienNumber` transforms implemented but not wired to the real I-129 widgets due
  to a `maxLength` overflow; open, characterized, not a regression.
- **§J.5** — visual smoke check outstanding (needs a human with browser access), carried forward from
  Phase 3, still open.
- Everything Phase 2/3 already flagged (P2-001 reverseSync heuristic, P3-001 NODE_ENV leak (fixed),
  same-form-only fan-out scope) is unchanged and carried forward without modification.
- **New recommendation (from P4-001/P4-003):** a future phase should add a permanent invariant test
  asserting every crosswalk-mapped `USCISFormTemplate.activeMappingVersionId` is set and points at a
  `status:"active"` version, so this defect class is caught automatically rather than requiring a
  manual per-form check.
