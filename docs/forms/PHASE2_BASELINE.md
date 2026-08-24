# Phase 2 Baseline — Canonical Write-Back & Reverse Sync (§I.1–§I.6)

Covers all of Phase 2's planned work: `CanonicalProfileService.applyStaffEdit` (§I.1),
`ReverseIndexService` (§I.2), the `AutoFillService.overrideField` reroute (§I.3), `SyncStateService`
and its wiring into the fan-out (§I.4), the K-1/K-3 fan-out + P0-CD-001-boundary tests (§I.5), and the
`npm run phase2:verify` gate (§I.6). One known gap remains open by design — see §7.

## 1. `CanonicalProfileService.applyStaffEdit(caseId, edits, actor, req)`

Field-level, highest-precedence write into `Case.canonicalProfile`. `edits: [{path, value, reason,
sourceFormId?}]`.

- Mirrors `resolveConflict`'s sequence: load → authorize (`caseService.canAccessCase`) → diff → validate
  → version bump → history → audit → save.
- **Optimistic concurrency:** compare-and-swap via `Case.findOneAndUpdate({_id, "canonicalProfile.version":
  expectedVersion}, ...)`. A stale caller throws `{code: "STALE_FORM_REVISION", status: 409}`.
- **Idempotency:** a resubmitted edit that doesn't actually change the profile is a no-op — no version
  bump, no duplicate history entry, no event. Both sides of the no-op diff are JSON-round-tripped clones of
  the same source (see P2-002 — comparing a live Mongoose value against one clone produced false positives
  once the profile contained ObjectIds).
- **Durability across rebuild (§J.1 Option A — staff always wins):** `rebuild()` always recomputes
  `canonicalProfile.profile` from scratch via `CanonicalBuilderService.build()` (raw DB/questionnaire/OCR
  candidates only). `rebuild()` now re-applies every `staff_edit_applied` history entry on top of the
  freshly-built profile before saving (two new **private** static methods,
  `#collectStaffOverrides`/`#applyStaffOverrides` — private so the class's public surface only grows by
  `applyStaffEdit` itself, matching `phase0.invariants.test.js`'s method-allowlist). When a later
  rebuild's raw value disagrees with the staff override, the staff value still wins and a pending conflict
  is recorded in `canonicalProfile.conflicts` (`selectedSource: "staff_override"`) via the same
  `resolveConflict` UI/flow used for merge-detected conflicts — never silently overwritten either
  direction.
- **Event:** emits `staff-edit-applied` on `CanonicalProfileService.events` (a module-level `EventEmitter`)
  with `{caseId, canonicalVersion, changedPaths}`. Consumption is a later phase's (Phase 8) concern —
  Phase 2 only emits it.

## 2. `ReverseIndexService`

`Backend/src/modules/form-mapping/services/ReverseIndexService.js`. Canonical source path → `[{formCode,
pdfField, reverseSync}]`, built from the real compiled mapping graph (`FormMappingService.loadTemplate` +
`applyMappingGraph`) — never a hand-parsed crosswalk config file. Cached per `{formCode,
mappingVersionId}` pair.

- `buildFormReverseIndex(formCode)` → `Map<sourcePath, entries[]>` for one form.
- `buildReverseIndex(formCode?)` → plain object, merged across every active form when `formCode` is
  omitted.
- `lookupSource(pdfFieldName, formCode)` → the canonical source path, or `null` for a form-only field.
- `reverseSync` classification: `true` for a direct atomic mapping, `false` for anything conditional
  (`mappingType: "checkbox"`) or on a small denylist of known composite source-path suffixes (currently
  `["fullName"]`). **This is a documented heuristic, not a first-class graph property — see P2-001.**

Verified against the real seeded I-129 mapping graph: `person.lastName` → exactly 3 PDF fields
(`part3.form10Subform1Part3Line2FamilyName0`, `page24.form10Subform25Line1FamilyName4`,
`page24.form10Subform25HSupLine2FamilyName0`), all `reverseSync:true`; `person.fullName` → 1 PDF field,
`reverseSync:false`.

## 3. `AutoFillService.overrideField` reroute

`overrideField` remains responsible for the CaseForm/PDF edit. It never mutates `Case.canonicalProfile`
itself — `applyStaffEdit` is the **sole** canonical-mutation primitive. New flow:

1. `resolveReverseSync(formType, fieldId)` — looks up `{canonicalSourcePath, reverseSyncEligible}` via
   `ReverseIndexService.buildFormReverseIndex` (existing public API only, no new surface on
   `ReverseIndexService`).
2. **If eligible:** `CanonicalProfileService.applyStaffEdit(...)` runs **first**, before any CaseForm
   mutation — a stale/conflicting save throws before this CaseForm is touched at all, never
   half-applied.
3. The CaseForm-level write (mutate `filledData`/`fieldValues`/`sourceAttribution`/`manualOverrides`, push
   `FIELD_OVERRIDDEN` audit, save) is **byte-identical** to the pre-Phase-2 code — same shape, same
   fields, regardless of reverseSync eligibility. This is what keeps `phase0:verify`'s golden snapshots
   (which capture an `overrideExample` for a real mapped field, post-override) unmoved.
4. **If eligible AND the canonical value actually changed** (not an idempotent resubmit):
   `AutoFillService.generate(caseId, formType, user, req, {regenerate:true})` fans the new canonical value
   out to this form's other PDF fields sharing the same source. Reuses the existing regenerate path
   unchanged — `mergeMappedFields`'s `isReviewedOrManual` check already skips re-writing the
   just-overridden field (it's now a manual override), so only the untouched siblings pick up the fresh
   value. Not a parallel re-implementation.
5. **If not eligible** (derived/composite mapping like `person.fullName`, or a form-only/unmapped field):
   steps 2 and 4 never run — behavior is identical to before Phase 2.

Return contract unchanged (returns the `CaseForm`, now the regenerated one when a fan-out occurred) —
existing controllers (`AutoFillController.overrideField`, `interactiveFormReviewService.saveField`) need
no changes.

## 3a. `SyncStateService` and fan-out sync-state re-evaluation (§I.4)

`Backend/src/modules/form-mapping/services/SyncStateService.js`. Three explicit states, stored in
`sourceAttribution[pdfField].syncState` (already `Mixed` — `CaseForm.syncState` itself is a
strictly-typed subdocument and would silently drop an unrecognized sub-key, so it is **not** the
storage location):

- `SYNCED` — the field's value came from the last auto-fill/fan-out and matches canonical. Default
  when no marker has ever been written (`getSyncState` falls back to this).
- `MANUAL_OVERRIDE` — a case manager explicitly edited this exact field on this form.
- `CONFLICT` — a fan-out wanted to re-fill this field from canonical, but it already carries its own,
  different manual override. The stored value is **never** overwritten; `conflictCanonicalValue`/
  `conflictManualValue` are recorded alongside it so a source-panel UI can show both.

Wired into `overrideField`:

- The edited field is always marked `MANUAL_OVERRIDE` (regardless of reverseSync eligibility — a
  case manager's edit is a manual override on this form either way).
- After a reverseSync-eligible fan-out, every OTHER sibling field sharing the same canonical source is
  re-evaluated: untouched siblings become `SYNCED`; a sibling that already had its own independent
  manual override (from before this fan-out) becomes `CONFLICT` instead of being silently resynced,
  and a `CONFLICT_DETECTED` entry is pushed onto that `CaseForm`'s `auditHistory`.

This storage choice was checked against `phase0:verify`'s golden-snapshot mechanism before being
adopted: `goldenHarness.js`'s captured `overrideExample.sourceAttribution` is written to the committed
snapshot JSON but never diffed by `phase0Verify.js`'s `verifyVisa()` (which only hash-compares
`pdfFieldValuesHash`/`pdfSnapshotHash`, both computed *before* the override call) — so a new
`sourceAttribution` key cannot fail that gate, confirmed by running it.

## 4. Precedence policy (§J.1 — confirmed)

**Option A — staff always wins.** Confirmed by the user (session record, 2026-08-24). A
`staff_override`-sourced canonical value permanently outranks any later questionnaire/OCR/database value
for the same path. A disagreeing later value never silently overwrites it — it raises a pending conflict
in `canonicalProfile.conflicts`, resolved only through the existing `CanonicalProfileService.resolveConflict`
flow.

## 5. Test coverage

| File | Covers | Result |
|---|---|---|
| `Backend/src/modules/canonical/tests/CanonicalProfileService.applyStaffEdit.test.js` | version bump, history, audit, event, concurrency (STALE_FORM_REVISION), idempotency, rebuild-durability/precedence | 7/7 pass |
| `Backend/src/modules/form-mapping/tests/ReverseIndexService.test.js` | fan-out count, reverseSync:true/false classification, lookupSource (hit + form-only null), merged index | 6/6 pass |
| `Backend/src/modules/form-mapping/tests/AutoFillService.overrideField.reverseSync.test.js` | TEST 1–9 (direct reverse sync, repeated-field fan-out, derived-field non-sync, staff-wins conflict, idempotency, concurrency, form-only field, rebuild durability, caller regression via `InteractiveFormReviewService.saveField`) | 9/9 pass |
| `Backend/src/modules/canonical/tests/phase0.invariants.test.js` | method-surface allowlist (+`applyStaffEdit`), the two replacement invariants (reverseSync-eligible reaches canonical; derived/form-only does not) | 3/3 pass, plus the pre-existing crosswalk/mapping-version invariants in the same file |
| `Backend/src/modules/form-mapping/tests/SyncStateService.test.js` | the 4 static helpers + `getSyncState`'s default, in isolation | 5/5 pass |
| `Backend/src/modules/form-mapping/tests/AutoFillService.overrideField.k1k3-fanout.test.js` | K-1 (I-129F) fan-out (`person.citizenship`, 2 fields), K-3 (I-130) fan-out (`contact.address.zip`, 11 fields), the P0-CD-001 boundary (the 10 documented petitioner/beneficiary fields are absent from the reverse index) | 3/3 pass |

TEST 10/11 in `AutoFillService.overrideField.reverseSync.test.js` cover §I.4 specifically: the edited
field becomes `MANUAL_OVERRIDE` and untouched siblings become `SYNCED` (TEST 10); a sibling with its
own pre-existing independent manual override becomes `CONFLICT`, its value is not overwritten, and a
`CONFLICT_DETECTED` audit entry is recorded (TEST 11).

`phase0:verify`: PASS (h1b/l1a/k3 golden PDFs unchanged, 26/26 invariant+coverage tests).
`phase1:verify`: PASS (lock-in tests, reconciliation report, doc-size guard, phase0:verify all green).
`phase2:verify` (§I.6, `Backend/src/scripts/phase2Verify.js`): PASS — runs the full Phase 2 test suite
(37 tests) + `phase1:verify` (which itself runs `phase0:verify`) + a diff-scope guard + a per-form
fan-out summary (`I-129: person.lastName -> 3 fields`, `I-129F: person.citizenship -> 2 fields`,
`I-130: contact.address.zip -> 11 fields`, all `reverseSync:true`).

All DB-backed tests run against the local test DB (`mongodb://localhost:27017/immigrationcrm_test` via
`test-utils/db.js`'s `connectTestDB`) — never the real/Atlas `MONGODB_URI`.

## 6. `phase2:verify`'s diff-scope guard (§I.6)

The task spec describes this guard as `git diff --name-only $(git merge-base HEAD main) HEAD`. This
repo's actual branch (`refactor`) has substantial unrelated, legitimate history (Phase 0/1, CORS, auth,
document-AI work) already committed and diverged from `main` — a merge-base diff against `main` would
list all of that, not just Phase 2's slice, so the allowlist check would fail for reasons that have
nothing to do with Phase 2. `phase2Verify.js`'s guard instead checks `git status --porcelain` — the
currently uncommitted working tree, which is what Phase 2's own changes actually are in this session.
If this work is later committed, re-point the guard at a diff against the commit immediately before
Phase 2 started (the script cannot infer that commit reliably on its own — see the comment at the top
of `phase2Verify.js`).

## 7. Known gaps / deliberately out-of-scope

- **P2-001** — `reverseSync` classification is a documented heuristic (condition-presence +
  checkbox-mappingType + a source-path denylist), not a first-class mapping-graph property. Open;
  planned for whichever phase introduces a mapping-schema change.
- **P2-002** — fixed in phase (§I.1/§I.3 testing surfaced it); see the ledger entry for the root cause
  (an ObjectId-diff asymmetry in `applyStaffEdit`'s idempotency check).
- Same-form-only fan-out: §I.3/§I.4/§I.5 fan out to sibling PDF fields on the **same** CaseForm only.
  Cross-form-type fan-out (e.g. a shared canonical field also present on a different form on the same
  case) was explicitly out of this phase's boundary and is not implemented.
- A version bump from `applyStaffEdit` itself is followed by a **second, separate** version bump from
  the fan-out's own `rebuild()` (triggered via `generate()` → `CanonicalDataService.build()`) —
  `rebuild()` has no no-op short-circuit of its own (only `applyStaffEdit` does). This is expected, not
  a bug: two distinct, correctly-attributed events (`staff_edit_applied` then `profile_rebuilt`), not a
  duplicate application of the same edit — confirmed via the `staff_edit_applied`-entry-count and
  audit-count assertions in TEST 1, rather than a raw version-delta assertion.
- I-130's `person.dob` fan-out (found while building the K-3 test) traces to an apparently stale
  `USCISMappingVersion` seed — see the P0-CD-001-boundary test's own comment in
  `AutoFillService.overrideField.k1k3-fanout.test.js` for what was observed and why it wasn't
  investigated further here.
