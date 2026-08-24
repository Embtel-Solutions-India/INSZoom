# Phase 3 Baseline — CI Fan-Out Gate, Sync-State Surface, Conflict Resolution, Autosave

Covers all of Phase 3's planned work (§I.1–§I.6). No backend Phase-2 file (`CanonicalProfileService.js`,
`AutoFillService.js`, `ReverseIndexService.js`, `SyncStateService.js`) or schema/pipeline file
(`CaseForm.js`, `MappingResolver.js`, `PDFRenderer.js`, `WatermarkService.js`, any crosswalk config)
was modified — confirmed by `phase3:verify`'s own diff-scope guard, which fails the whole gate if any
of those appear in the working tree.

## 1. Ground-truth corrections found before writing code (§F)

Several details in the task's own §E ground truth had drifted from the actual source, or the actual
source was materially richer than described. All were re-verified against the real files before any
change:

- **`USCISFormRenderer.jsx` doesn't exist at a generic path** — it's at
  `INSZoom/frontend/src/components/uscis/USCISFormRenderer.jsx` (1345 lines), with its test file
  alongside it.
- **The field-status function is `fieldFillTone(field, value, errors)`**, not an unnamed "field status
  function" with a 2-line body — it already had an `errors?.length` check and a `!hasValue(value)`
  early-return that the task's own suggested replacement body would have silently dropped. Both were
  preserved; `syncState` checks were added alongside them, not instead of them.
- **`SyncStateService.setManualOverride(caseForm, pdfField)` takes 2 arguments, not 3** — no `value`
  parameter exists (it only marks state; the value is already written elsewhere in `overrideField`).
  The task's own §E example showed a 3-argument signature.
- **A conflict-resolution UI and endpoint already existed** — `useCanonicalValue()` /
  `uscisFormsApi.resolveWorkspaceConflict` / `POST .../workspace/conflict` /
  `InteractiveFormReviewService.resolveConflict`. This is a **different, older** conflict concept
  (`canonicalState.conflicts` - multiple candidate SOURCES disagreeing on one canonical field, e.g.
  OCR vs. questionnaire) than Phase 2/3's per-field `sourceAttribution[fieldName].syncState ===
  "CONFLICT"` (a fan-out wanting to overwrite a field that already has its own independent manual
  override). The two are visually and functionally kept separate throughout this phase - see §3
  below - rather than merged or one replacing the other.
- **The before-unload guard already existed** (`dirtyFieldsRef.current.size`-based), correctly
  covering "saving", "retrying", and "failed" states for free, since a field only leaves
  `dirtyFieldsRef` on confirmed success. The task's own §E sketch proposed inventing a parallel
  `hasPendingChanges` ref - not built, since it would have duplicated an existing, already-correct
  mechanism.
- **`saveState` already had a richer state machine** (`saving`/`saved`/`error`/`dirty`/`idle`) with a
  real batch-autosave engine (`dirtyFieldsRef`, `savePendingChanges`, `saveFieldByName`) - no retry
  logic existed, but the existing `'error'` state already did what the task's proposed `'failed'`
  state would have; a redundant second terminal-failure state was not introduced. Only `'retrying'`
  is new.

## 2. §I.1 — CI fan-out invariant

`Backend/src/modules/form-mapping/tests/phase3.fanout-invariant.test.js`. Covers I-129 (3-way,
`person.lastName`), I-129F/K-1 (2-way, `person.citizenship`), I-130/K-3 (a real mapped field,
`contact.address.zip`, 11-way), the CONFLICT path on I-130, and the P0-CD-001 boundary. Runs in both
`npm test` (matches `src/**/*.test.js`) and `phase3:verify`.

**Deviation from the literal spec, documented in the test file itself:** the task's §I.1 says
"`Case.canonicalProfile.version` incremented exactly once." This is factually not what Phase 2 built
(documented in `PHASE2_BASELINE.md` §7): a single `overrideField` call on a reverseSync-eligible field
bumps the version **twice** - once from `applyStaffEdit`, once from the fan-out's own `generate()` →
`CanonicalDataService.build()` → `rebuild()` call, since `rebuild()` has no no-op short-circuit of its
own. Asserting a literal "+1" delta would make this permanent gate wrong by construction. The test
instead asserts the actually-meaningful invariant: the staff edit's `staff_edit_applied` history entry
appears exactly once (no duplicate application of the same edit) - which is what "incremented exactly
once" was actually trying to guarantee.

## 3. §I.2 — Sync state in the workspace API

`InteractiveFormReviewService.buildFieldView` now returns:
- `syncState`: `attribution.syncState || (caseForm.manualOverrides?.[fieldName] ? "MANUAL_OVERRIDE" :
  "SYNCED")` - note this fallback is NOT the same as `SyncStateService.getSyncState`'s own default
  (which always falls back to `SYNCED` regardless of `manualOverrides`); a pre-Phase-2 CaseForm with a
  real manual override but no `syncState` marker must still show "Manual" to the CM, so
  `buildFieldView` has its own, slightly different backwards-compat rule.
- `conflictValues`: `{canonicalValue, manualValue}` from `sourceAttribution[fieldName]`, only present
  when `syncState === "CONFLICT"`.

Unit-tested directly (no DB) in `interactive-form-review.service.test.js`, alongside the existing
`buildFieldView` test for the OLDER `canonicalState.conflicts` concept - both coexist in the same file
since `buildFieldView` returns both `conflicts` (old) and `syncState`/`conflictValues` (new).

## 4. §I.3/§I.4 — Frontend: badges and conflict resolution

`fieldFillTone` now checks `field.syncState` (`CONFLICT` → red, `MANUAL_OVERRIDE` → violet, `SYNCED` →
blue) in addition to, not instead of, its existing `errors`/`conflicts`/`hasValue` checks. The
sidebar's field-detail panel now renders **two independent badge pairs** since two independent conflict
concepts coexist: the pre-existing amber "Conflict" (`selectedField.conflicts?.length`, unchanged) and
a new red "Field Conflict" (`selectedField.syncState === "CONFLICT"`) - both can render simultaneously.
A new "Conflict detected" panel (visually distinct - red, not the pre-existing amber "Source conflict"
panel) renders "Use canonical value" / "Keep my edit" buttons when `syncState === "CONFLICT"`, calling a
new `resolveFieldConflict(direction)` function → `uscisFormsApi.resolveFieldConflict` → `POST
.../workspace/field/resolve-conflict` (a **new, separate** route from the pre-existing
`.../workspace/conflict`) → `InteractiveFormReviewService.resolveFieldConflict` (a **new, separate**
service method from the pre-existing `resolveConflict`).

Backend `resolveFieldConflict(caseId, caseFormId, {fieldName, direction}, user, req)`:
- Rejects (409) if the field's `syncState` isn't actually `"CONFLICT"` - never silently no-ops or picks
  a side for a field that was never in conflict.
- `direction: "canonical"` - `applyStaffEdit` reconfirms the canonical value (idempotent - it already
  holds this exact value), writes it into `filledData`/`fieldValues`, `SyncStateService.setSynced`.
- `direction: "manual"` - `SyncStateService.setManualOverride`; `applyStaffEdit` re-confirms the CM's
  kept value as the staff-locked canonical value **only if the field is itself reverseSync-eligible**
  (checked via `ReverseIndexService.buildFormReverseIndex`) - a derived/composite or form-only field's
  "manual" resolution never touches canonical, matching `overrideField`'s own rule.
- Both directions push exactly one `fieldHistory` entry (`action: "conflict_resolved"`,
  `metadata.direction`) in the **same** `.save()` call that persists the `syncState` change (§G's
  atomicity requirement) - never two separate saves that could diverge under a mid-request failure.

`api.js` (`INSZoom/frontend/src/services/api.js`) gained one new client function,
`resolveFieldConflict` - **not in the task's literal §K-G8 allowed-file list**, but structurally
required (the frontend cannot call the new endpoint without it); documented here and in
`phase3Verify.js`'s own diff-scope allowlist rather than silently added.

## 5. §I.5 — Autosave reliability

`saveFieldByName` retries its own `uscisFormsApi.saveWorkspaceField` call up to 3 times with
exponential backoff (500ms, 1s, 2s) before re-throwing, entering `saveState: 'retrying'` from the
second attempt onward. `savePendingChanges`'s existing try/catch is unchanged - it still sees exactly
one thrown error after all retries are exhausted, and still sets the pre-existing `'error'` state
(already styled "Save failed"). The header badge now renders `'error'` as a **clickable button**
("⚠ Save failed — click to retry") that calls `savePendingChanges` again - which naturally retries
whatever is still in `dirtyFieldsRef` (a failed save is never removed from it), reusing the existing
retry/idempotency machinery rather than a separate "retryLastSave" function.

The before-unload guard was **not modified** - it already correctly covers "saving"/"retrying"/"failed"
via `dirtyFieldsRef.current.size`, since a field only leaves that set on confirmed success.

Idempotency: the backend's `overrideField` no-op/idempotency guarantee (from Phase 2, unmodified) is
what actually prevents a retried save from producing duplicate `fieldHistory`/canonical mutations - the
frontend retry loop's job is only to keep trying until one attempt succeeds, not to reason about
duplication itself.

## 6. §I.6 — `phase3:verify`

`Backend/src/scripts/phase3Verify.js`. Runs: the Phase 3 backend test suite, the frontend component
tests (`USCISFormRenderer.test.jsx`, invoked via the local `vitest` binary), the Phase 2 test suite,
`phase1:verify` (which runs `phase0:verify`), and a diff-scope guard.

**Two deviations from the literal spec, both documented in the script's own header comment:**

- **Does not call `phase2:verify` as a black box.** `phase2Verify.js`'s own diff-scope guard checks
  against Phase 2's allowlist only, which would always fail the moment Phase 3's own (legitimately
  allowed) files exist in the working tree. `phase3Verify.js` instead re-runs Phase 2's test suite and
  `phase1Verify.js` directly, and its own diff-scope guard (with an allowlist covering both phases)
  is the authoritative check for the combined working tree.
- **Diff-scope guard checks `git status --porcelain`**, not a `main`-merge-base diff - same rationale
  as `phase2Verify.js` (this branch has substantial unrelated history already committed; a merge-base
  diff would list all of it).

**Bug found and fixed while building this script:** invoking the frontend's vitest via a child
process inherited `NODE_ENV=production` from this script's own `dotenv.config()` (which loads
`Backend/.env`), which broke jsdom's global `Blob` inside vitest ("Blob is not a constructor") -
reproducible only through this script, not when vitest is run standalone from the frontend directory.
Fixed by explicitly setting `NODE_ENV: "test"` for that one child process. See the P3-001 ledger entry.

## 7. Test coverage summary

| Suite | Result |
|---|---|
| `phase3.fanout-invariant.test.js` | 6/6 pass |
| `interactive-form-review.service.test.js` (incl. 3 new `buildFieldView` tests) | 6/6 pass |
| `interactive-form-review.resolveFieldConflict.test.js` | 7/7 pass (both directions, not-in-conflict 409, unauthorized 403, locked 409, bad direction 400) |
| `interactive-form-review.routes.test.js` (incl. new route + middleware-chain check) | 2/2 pass |
| `USCISFormRenderer.test.jsx` (incl. 8 new Phase 3 tests) | 12/12 pass |

`phase3:verify`: **PASS** (Phase 3 backend 21/21, frontend 12/12, Phase 2 suite 37/37, `phase1:verify`
PASS including `phase0:verify` with byte-identical golden PDFs, diff-scope guard PASS).

## 8. §J.5 — visual smoke check

**Not performed by the agent.** This check is explicitly visual (real browser, real seeded case) and
cannot be automated - see `docs/forms/PHASE3_RUN_JOURNAL.md` for the outstanding item recorded for the
user to run and confirm before Phase 3 is considered fully closed per its own G9 gate.

## 9. Known gaps

- **P3-001** — `phase3Verify.js`'s frontend-test child process inherited a production `NODE_ENV` from
  this script's own dotenv load, breaking vitest's jsdom Blob setup. Fixed in phase.
- **§J.5** — visual smoke check outstanding (needs a human with browser access).
- Everything else Phase 2 already flagged (P2-001 reverseSync heuristic, same-form-only fan-out scope)
  is unchanged and still open, carried forward without modification.
