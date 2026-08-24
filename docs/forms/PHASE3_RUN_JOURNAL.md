# Phase 3 Run Journal

## 2026-08-25 — §F pre-work / ground truth verification

- Ran `phase2:verify` first to confirm the Phase 2 baseline: PASS (37/37 Phase 2 tests, `phase1:verify`
  PASS including `phase0:verify`, diff-scope guard PASS, per-form fan-out summary printed).
- `USCISFormRenderer.jsx` does not exist at any generic path - located it at
  `INSZoom/frontend/src/components/uscis/USCISFormRenderer.jsx` (1345 lines) via a repo-wide search,
  alongside its existing test file.
- Read the full component (not just the line ranges §E quoted) before touching anything. Found several
  drifts from §E's ground truth, all recorded in `PHASE3_BASELINE.md` §1:
  - The field-status function is `fieldFillTone(field, value, errors)` with an `errors` check and a
    `!hasValue` early-return §E's suggested replacement body would have silently dropped.
  - `SyncStateService.setManualOverride` takes 2 arguments (`caseForm, pdfField`), not 3 - re-confirmed
    directly from the Phase 2 source rather than trusting §E's example.
  - A conflict-resolution UI and endpoint (`useCanonicalValue`, `resolveWorkspaceConflict`,
    `POST .../workspace/conflict`, `InteractiveFormReviewService.resolveConflict`) already existed -
    traced it fully (frontend function → `api.js` → route → controller → service) before concluding
    it operates on a DIFFERENT, older conflict concept (canonical-merge candidate disagreement) than
    Phase 2/3's per-field sync-state conflict. Decided to keep both systems visually and functionally
    separate rather than merge them or have one replace the other.
  - The before-unload guard already existed (`dirtyFieldsRef.current.size`-based) and already
    correctly covers "saving"/"retrying"/"failed" - the task's suggested `hasPendingChanges` ref would
    have duplicated it. Not built.
  - The autosave engine (`saveFieldByName`/`savePendingChanges`/`dirtyFieldsRef`) was already far more
    sophisticated than §E implied, with an existing `'error'` state that already does what the task's
    proposed `'failed'` state would have. Only added `'retrying'` as genuinely new.

## 2026-08-25 — §I.1 (CI fan-out invariant) + §I.2 (sync state in workspace API)

- Verified empirically (via the same `person.lastName`/`person.citizenship`/`contact.address.zip`
  sources already proven in Phase 2's own tests) that a single `overrideField` call bumps
  `canonicalProfile.version` TWICE, not once - matches what `PHASE2_BASELINE.md` §7 already documented.
  Wrote `phase3.fanout-invariant.test.js`'s assertion around the semantically meaningful invariant
  (exactly one `staff_edit_applied` entry) instead of the task's literal "+1" wording, with the
  discrepancy explained in the test file's own comment.
- Extended `buildFieldView` to add `syncState`/`conflictValues`. Confirmed via a quick check of
  `phase0Verify.js`/`goldenHarness.js` that adding a new `sourceAttribution` key is safe (the golden
  hash comparison never reads `overrideExample.sourceAttribution` at all) before assuming it was.
- All new tests green on first correct run.

## 2026-08-25 — §I.3/§I.4 (frontend badges + conflict resolution) + backend `resolveFieldConflict`

- Implemented `resolveFieldConflict` as a genuinely separate service method/route
  (`POST .../workspace/field/resolve-conflict`) from the pre-existing `resolveConflict`
  (`POST .../workspace/conflict`), to avoid confusing the two conflict concepts.
- Added `api.js`'s `resolveFieldConflict` client function - not in the task's literal §K-G8 allowed-
  file list, but structurally required (the frontend cannot call the new endpoint otherwise). Flagged
  explicitly rather than silently added; included in `phase3Verify.js`'s own diff-scope allowlist with
  a comment explaining why.
- Extended `fieldFillTone` and the sidebar badges additively - both old (`conflicts`) and new
  (`syncState`) badges can render simultaneously, since they represent independent, coexisting
  concepts. Added a visually distinct (red, not amber) "Conflict detected" panel for the new
  CONFLICT state, next to the pre-existing amber "Source conflict" panel.
- Backend tests (7 scenarios: both directions, not-in-conflict, unauthorized, locked, bad direction)
  all green on first correct run, reusing the exact conflict-production technique proven in Phase 2's
  own TEST 11 (a sibling field with its own independent manual override, then a fan-out-triggering
  edit on a different sibling).
- Added the new route to the existing route-registration test (`interactive-form-review.routes.test.js`)
  and a new assertion confirming its auth-middleware chain matches `saveInteractiveField`'s exactly
  (§J.4) - both green.

## 2026-08-25 — §I.5 (autosave retry) + frontend component tests

- Added retry-with-backoff (500ms/1s/2s) directly inside the existing `saveFieldByName`, rather than a
  parallel `actionWithRetry` wrapper - reuses `savePendingChanges`'s existing error handling, `'error'`
  state, and message display unchanged.
- Made the header's `'error'` badge a clickable "click to retry" button that calls `savePendingChanges`
  again - relies on the existing `dirtyFieldsRef` (a failed field is never removed from it) rather than
  a new "retry the last save" function.
- Extended `USCISFormRenderer.test.jsx`'s API mock to allow per-test control of `saveWorkspaceField`/
  `resolveFieldConflict` (previously hard-coded to always resolve). Wrote 8 new component tests: 4 for
  sync-state badges (CONFLICT/MANUAL_OVERRIDE/SYNCED/backwards-compat), 2 for the conflict-resolution
  buttons, 1 for autosave retry (fail twice, succeed on the 3rd attempt, `saveWorkspaceField` called
  exactly 3 times, eventual "Saved ✓"), 1 for the before-unload guard.
- One test-authoring bug caught and fixed immediately: the first CONFLICT-badge test asserted on the
  text "Smith" with `getByText`, which matched twice (once in the field overlay, once in the new
  conflict panel) - scoped the assertion to the conflict panel's own container instead of weakening it.
- All 12 component tests green (some benign React `act()` console warnings from the retry timer's
  async state updates outside explicit test `await` boundaries - cosmetic, does not affect pass/fail,
  not chased further given the time cost of correctly fake-timer-driving an async backoff loop).

## 2026-08-25 — §I.6 (`phase3:verify`)

- First draft called `node src/scripts/phase2Verify.js` as a black box per the task's literal wording.
  **Diagnosed and reverted**: `phase2Verify.js`'s own diff-scope guard checks Phase 2's allowlist only,
  which fails the instant Phase 3's own (legitimately allowed) files exist in the working tree - not a
  real regression, a structural mismatch between "run the whole previous gate" and "phases build
  cumulatively on an uncommitted shared working tree." Rewrote to re-run Phase 2's test suite and
  `phase1Verify.js` directly, with Phase 3's own diff-scope guard (allowlist covering both phases)
  as the authoritative check - documented in the script's own header comment and in
  `PHASE3_BASELINE.md` §6.
- **Bug found and fixed (P3-001)**: the frontend vitest child process inherited `NODE_ENV=production`
  from this script's own `dotenv.config()` load of `Backend/.env`, breaking jsdom's global `Blob`
  inside vitest ("Blob is not a constructor") - reproducible only through this script, not when vitest
  runs standalone. Fixed by explicitly setting `NODE_ENV: "test"` for that one child process.
- Also fixed the vitest invocation mechanism itself: running `node node_modules/vitest/vitest.mjs run
  ...` directly skips part of vitest's own CLI bootstrap; switched to invoking the `.bin/vitest.cmd`
  shim with `shell: true` (the same resolution path `npx vitest run` itself uses).
- Final run: `phase3:verify` → PASS (Phase 3 backend 21/21, frontend 12/12, Phase 2 suite 37/37,
  `phase1:verify` PASS including `phase0:verify`, diff-scope guard PASS).

## §J.5 — outstanding (recorded, not performed)

The visual smoke check (§J.5) requires a human with browser access to a real seeded H-1B case:
open the I-129 form, edit a repeated field, confirm the "Saved ✓" cycle and the amber "Manual" badge,
confirm untouched siblings show no badge, trigger a real CONFLICT and confirm the red "Field Conflict"
badge + "Conflict detected" panel, click "Use canonical value" and confirm the badge clears, then kill
the network mid-save and confirm the "Retrying save…" indicator and the before-unload warning both
fire. Not performed by the agent - this check is explicitly visual and cannot be automated. Phase 3's
G9 gate is not fully closed until this is recorded by a human (who ran it, when, what was observed).

## Diff scope (all three phases combined)

Phase 2's files (`CanonicalProfileService.js`, `AutoFillService.js`, `ReverseIndexService.js` (new),
`SyncStateService.js` (new), `phase2Verify.js` (new)) plus Phase 3's
(`interactive-form-review.service.js`, `uscis-form.controller.js`, `uscis-form.routes.js`,
`USCISFormRenderer.jsx`, `USCISFormRenderer.test.jsx`, `api.js`, `phase3Verify.js` (new)), 10 new/updated
test files across both phases, `package.json` (scripts only), `ARCHITECTURE.md`, and the docs/ledger
files for both phases. No crosswalk file, `CaseForm.js` schema, `MappingResolver.js`, `PDFRenderer.js`,
or `WatermarkService.js` touched at any point - confirmed by `phase3:verify`'s own diff-scope guard.
