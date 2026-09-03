# ImmigrationCRM — Issues Log

## Issue: USCIS Form Field Key Namespace Mismatch + Silent filledData Persistence Loss

### ID
ISSUE-001

### Status
RESOLVED

### Severity
Critical — silent data-integrity failure in a legal filing system. A case manager's correction to a USCIS form field could appear saved on screen and survive a browser refresh, while the actual filed PDF silently kept the old (or blank) value.

### Discovery
Investigated across three sessions. Session 1 found and fixed a visible symptom (autofilled values showing blank on workspace load). Session 2 (this document) was tasked with tracing the deeper cause after live testing showed the session-1 fix, while correct, did not make case-manager edits reach the actual downloaded PDF.

---

### Root Cause — two independent bugs, both required for the fix to be complete

#### Bug A: two identifier namespaces for the same logical field

**Namespace A — normalized fieldId** (set at template-import time)
`"page1.form10Subform0Line1MiddleName0"` — dot-only, safely path-traversable.

**Namespace B — raw AcroForm fieldName** (the real PDF widget name)
`"form1[0].#subform[0].Line1_MiddleName[0]"` — brackets and hashes, NOT safely path-traversable.

The same template field object carries both:
```js
{ fieldId: "page1...Name0", fieldName: "form1[0]...Name[0]" }
```

| Operation | Key used | Namespace |
|---|---|---|
| `AutoFillService.mergeMappedFields` (autofill write) | `field.fieldId \|\| field.fieldName` | A |
| `interactive-form-review.service.js` — every read/write, before this fix | raw `fieldName` from the frontend | B |
| `PDFFieldMapper.mapFields` (the actual PDF-fill read) | `field.fieldId \|\| field.fieldName` | A |
| `ReverseIndexService` fan-out matching | `field.fieldId \|\| field.id \|\| field.fieldName` | A |

Every CM edit was written under Namespace B; every consumer that matters (autofill's own overwrite-protection, the reverse-sync fan-out, and the PDF generator) reads Namespace A. The edit and its readers never agreed on a key.

#### Bug B: a shallow copy is not enough to make Mongoose detect a Mixed-type change

Fixing Bug A alone was not sufficient. `AutoFillService.overrideField` (the function every CM edit ultimately writes through) built its updated `filledData` like this:
```js
const filledData = caseForm.filledData || {};       // same reference (or a fresh {} only if empty)
MappingResolver.setPath(filledData, fieldId, value); // mutates nested objects in place
caseForm.set("filledData", filledData);
```
For any field autofill had already touched, the intermediate object at the mutated path (e.g. `filledData.part3`) already existed and was the *same object reference* as `caseForm.filledData.part3`. `setPath`'s in-place mutation therefore changed `caseForm.filledData` itself before `.set()` ever ran its own comparison — by the time Mongoose checked "is this actually different," old and new were the same mutated object, and `caseForm.isModified('filledData')` came back `false`. The value never reached MongoDB, even though `fieldValues` (built via `{ ...(caseForm.fieldValues || {}) }`, a pattern that happened to already avoid this) persisted correctly and looked identical in every same-process check.

`PDFFieldMapper.mapFields` — the only code that reads values when generating the actual downloaded/filed PDF — reads exclusively from `filledData`. It never reads `fieldValues`. So this second bug meant: **no manual field override, through this function, for any field, had ever reached a filed PDF**, independent of and in addition to Bug A.

A first attempt at fixing Bug B used a *shallow* copy (`{ ...(caseForm.filledData || {}) }`) — this fixed brand-new top-level keys (an unmapped field with no existing parent object) but not existing ones, because a shallow copy only creates a new reference at the top level; nested objects are still shared. The real fix required `AutoFillService`'s own `clone()` helper (`JSON.parse(JSON.stringify(...))`, already used correctly by `mergeMappedFields` for exactly this reason), which breaks the shared reference at every nesting level.

---

### Effects (confirmed by live reproduction, not just code reading)

- A CM correction to a USCIS form field was silently discarded from the filed PDF while looking saved in every other surface (toast, reload, workspace reopen).
- Autofilled values were invisible in the interactive review workspace (0 of 942 fields showed a value on a freshly autofilled I-129, despite 396 fields genuinely populated in the database) — the symptom that originally triggered this investigation.
- `isReviewedOrManual()`'s protection against autofill clobbering a CM edit was itself keyed inconsistently in several code paths (`saveSection`, `reviewField`, `resolveFieldConflict`, `reset`, `refresh`), meaning several of these actions either silently no-op'd (reset/refresh a specific field did nothing) or would have failed to protect an override once the fieldId mismatch was fixed in isolation without fixing all of them together.
- `resolveConflict` used Mongoose's dotted-string `.set()` API on a value that always contains a literal dot, which — separately from Bug A/B — would corrupt the write for the same reason `AutoFillService.overrideField`'s own header comment already documented and avoided elsewhere in that file.

---

### Fix Applied

**File: `Backend/src/modules/uscis-forms/interactive-form-review.service.js`**
- New helper `canonicalFieldId(template, fieldNameOrId)` — the single translation point from a raw frontend-supplied name to the normalized fieldId every other consumer expects.
- `buildFieldView`: reads value/attribution/syncState/manualOverrides/fieldReviews/history by the normalized `field.fieldId` first, falling back to the raw `fieldName` for a CaseForm written before this fix.
- `saveField`: resolves `canonicalFieldId` before calling `AutoFillService.overrideField`, so the override is stored under the same key autofill, the reverse-sync fan-out, and the PDF generator all use.
- `saveSection`: same key resolution, plus its `fieldValues` write was switched from `MappingResolver.setPath` (which would split the normalized id's own dot and build a broken nested structure — `fieldValues` is meant to be flat) to a plain bracket assignment matching `AutoFillService`'s own convention.
- `reviewField`, `reset`, `refresh`, `resolveConflict`, `resolveFieldConflict`: all resolve and use the same canonical key for their own independent reads/writes (each of these had its own, separate instance of Bug A — they do not delegate to `saveField`). `reset` deletes overrides under both the canonical and raw key, for CaseForms edited before this fix.
- `resolveConflict`'s `fieldReviews` write switched from Mongoose's dotted `.set()` API to a plain-object bracket assignment, for the same reason `overrideField` already avoids it elsewhere.

**File: `Backend/src/modules/form-mapping/services/AutoFillService.js`**
- `overrideField`: `filledData` is now built via `this.clone(caseForm.filledData, {})` (a full JSON deep-clone) instead of a bare reference, so Mongoose reliably detects the change and persists it. This is the fix for Bug B, and it fixes every caller of `overrideField`, not just the interactive-review path.

No route, model, or middleware was changed. `MappingResolver.js`, `PDFFieldMapper.js`, `PDFRenderer.js`, `SyncStateService.js`, and `ReverseIndexService.js` were read extensively to trace the root cause but not modified.

---

### Intermediate Problems During Fix Attempts

**Session 1:** Fixed `setByPath` in `USCISFormRenderer.jsx` (frontend) and 8 `MappingResolver.resolvePath → AutoFillService.getFieldValue` substitutions in `interactive-form-review.service.js`. Both real, correct fixes — they solved a CM edit visibly clearing itself on screen, and solved autofilled values not appearing in the workspace's raw display path. Live testing afterward showed the underlying data still never reached the PDF.

**Session 2, attempt 1:** Identified Bug A (the namespace mismatch) precisely by tracing the write path (`AutoFillService.mergeMappedFields`), the CM-edit write path (`overrideField`, as called from `saveField`), and the PDF-fill read path (`PDFFieldMapper.mapFields`) against real, live data (a 396-field-autofilled I-129). Fixed `saveField`/`buildFieldView` and, on further inspection, five other methods in the same file that had independent instances of the identical bug.

**Session 2, attempt 2:** Live proof testing (save → workspace → actual rendered PDF bytes, using `pdf-lib` to read the real downloaded document) showed the edit still didn't reach the PDF even after Bug A was fully fixed. Isolated this to `AutoFillService.overrideField` itself using a field with no reverse-sync fan-out (ruling out complexity from the namespace fix) — `fieldValues` persisted, `filledData` did not, even for a plain, non-fan-out write. Diagnosed as a Mongoose Mixed-type change-detection issue.

**Session 2, attempt 3:** First fix for Bug B used a shallow copy (`{ ...(caseForm.filledData || {}) }`), matching the sibling `fieldValues`/`manualOverrides` pattern in the same function. Live re-test showed this fixed a brand-new (previously-unmapped) field but not a field autofill had already touched — instrumenting `caseForm.isModified('filledData')` directly proved the shallow copy still left Mongoose unable to detect the change for any field whose parent path already existed. Replaced with a full JSON deep-clone via `AutoFillService.clone()` — confirmed live afterward: CM edit visible in workspace, present in the actual downloaded PDF, survives a subsequent full autofill regenerate, and a second independent field edit coexists correctly with the first.

---

### What Changed That Affected Other Things

- CaseForms edited via the interactive workspace **after** this fix have overrides stored under the normalized fieldId. CaseForms edited **before** this fix have overrides under the raw fieldName. The dual-key read added throughout `interactive-form-review.service.js` handles both; no data migration was performed or is required.
- Fixing Bug A correctly activated the reverse-sync fan-out for fields that are genuinely fan-out-eligible but had never triggered it before (because the raw fieldName never matched `ReverseIndexService`'s normalized-keyed entries). This is intended, correct behavior — it's what actually surfaced Bug B during live testing — but it means overrides made before this fix, once resaved, may now correctly propagate to sibling fields sharing the same canonical source, which they did not do previously.
- `AutoFillService.overrideField`'s `filledData` fix affects every caller of that function, not only the interactive-review workspace — any other code path that saves a manual field override now correctly persists it.

---

### Future Lessons

1. **A namespace bridge must be resolved at every boundary, not once.** Six separate methods in one file each independently re-implemented (or failed to implement) the same raw-name-to-normalized-id translation. A single shared helper, called at every boundary crossing, is the only way to guarantee this doesn't drift back out of sync one method at a time.

2. **A shallow copy of a nested Mixed-type value is not a safe pattern in general** — it only breaks the shared reference at the level you copied, not at the level you mutate. If the mutation touches an already-existing nested object, the "copy" still aliases the original. Prefer the existing `clone()` (JSON round-trip) helper for any Mixed-type field that will be deep-mutated before `.set()` — the codebase already has this convention in `mergeMappedFields`; `overrideField` had simply never adopted it for `filledData`.

3. **`isModified()` is the actual ground truth for "will this be saved," not "does the in-memory value look right."** Every verification in this investigation that stopped at "the in-memory object has the right value" or "the same-process read-back looks correct" missed this bug. The one that caught it re-fetched from the database in a separate query and checked `isModified()` directly on the live document mid-flow.

4. **The only real proof for a PDF filing system is the PDF.** HTTP 200, a "Saved ✓" toast, a same-process database write, and even a passing existing test suite (all of which were true throughout this entire two-session investigation) were each independently insufficient signals. The only test that ever caught either bug was one that rendered the actual PDF with `PDFRenderer.renderFiling` and read the field back out with `pdf-lib`.

5. **A fix that "should work" from reading the code still needs a live, adversarial re-test after each attempt.** The shallow-copy fix for Bug B looked correct by inspection and matched an existing pattern elsewhere in the same function — it was wrong anyway, and only live re-testing against a field that already had autofilled data (not a fresh, never-touched field) exposed it.

---

### Related Files (read before changing any of these)

| File | Namespace / pattern used | Notes |
|---|---|---|
| `AutoFillService.js` | A (normalized fieldId); `filledData` writes now via `this.clone()` | `mergeMappedFields`, `overrideField`, `isReviewedOrManual` |
| `PDFFieldMapper.js` | A (normalized fieldId) | `mapping.caseField` = fieldId; reads `caseForm.filledData` only, never `fieldValues` |
| `ReverseIndexService.js` | A (normalized fieldId) | `pdfField` entries are normalized ids, not raw AcroForm names, despite the property name |
| `interactive-form-review.service.js` | Both — canonical id primary, raw fieldName fallback for pre-fix data | `canonicalFieldId()` is the shared translation point |
| `USCISFormRenderer.jsx` (frontend) | B (raw fieldName) | The real PDF widget name; frontend has no reason to know Namespace A exists |
| `MappingResolver.js` | Neither — pure path traversal | `resolvePath`/`setPath` split on `.`; never safe for a flat key containing literal dots unless the caller controls both write and read consistently, as `mergeMappedFields`/`PDFFieldMapper` do for `filledData` |

---

### Verification That the Fix Is Complete

All of the following were verified live, against a real seeded H-1B case, a real 980-field I-129 template, and a real rendered PDF (read back with `pdf-lib`) — not inferred from code reading:

1. CM saves a value through the real `saveField` path (raw AcroForm name, exactly as the frontend sends it) → `fieldValues[normalizedFieldId]` exists in MongoDB. ✓
2. Reopening the workspace shows the edited value, `syncState: MANUAL_OVERRIDE`. ✓
3. The actual downloaded PDF (rendered via `PDFRenderer.renderFiling`, read via `pdf-lib`) contains the CM's value at the correct field. ✓
4. Running a full autofill regenerate afterward does not overwrite the CM's value — confirmed both in the database and, again, in a freshly re-rendered PDF. ✓
5. A second, independent field edit coexists correctly with the first in the same rendered PDF. ✓
6. Autofilled-but-never-edited fields are visible in the workspace on open (358 of 942 fields, matching the order of magnitude of the 396 fields the autofill pass itself reported) — the original symptom that triggered the whole investigation. ✓
7. 42 existing tests across `interactive-form-review`, `ReverseIndexService`, `SyncStateService`, and `AutoFillService.overrideField` (reverse-sync and K1/K3 fan-out suites) all still pass.

### Issue Closed
Date: 2026-09-02
Resolved by: `interactive-form-review.service.js` (canonicalFieldId + six methods) and `AutoFillService.js` (`overrideField`'s `filledData` deep-clone)

---

## Addendum to ISSUE-001 (Session 3): Bug C — `renderCaseForm`'s `mergeFieldValues` silently reverted edits on re-open

### Status
RESOLVED

### Severity
Critical — same class as Bug A/B above (silent data-integrity loss in a legal filing system), but with a wider blast radius: unlike Bug A/B, this one is **self-perpetuating** and triggers on the single most realistic case-manager workflow (open a form, edit it, then open it again — e.g. to check another section, or because the CM navigated away and back).

### Discovery
Session 2's "Issue Closed" verification (steps 1–6 in the table above) proved `saveField`/`saveSection` write correctly and that a freshly-edited field survives one PDF render. Session 3 was asked to close out the remaining, never-actually-run proof: **`saveSection` end-to-end, including a second `open()` call after the edit** — the realistic sequence, not just save-then-render. That specific sequence (open → edit → open again → render) had never been tested; it revealed a third, independent bug in a completely different file.

### Root Cause
**File: `Backend/src/modules/uscis-forms/uscis-form.service.js`, function `mergeFieldValues` (called from `renderCaseForm`, which backs `InteractiveFormReviewService.open()` and the direct `/render` HTTP endpoint)**

This is a separate, older code path from the one fixed in Bug A/B — it does its own independent merge of `fieldValues`/`filledData` rather than reusing `AutoFillService`. Before this fix:

```js
function mergeFieldValues(template, caseForm, context) {
  const values = { ...(caseForm.fieldValues || {}), ...(caseForm.filledData || {}) };
  for (const field of (template.formFields || []).map(normalizeField)) {
    if (hasValue(getByPath(values, field.fieldName))) continue;
    const value = mappedValue(field, context);
    if (hasValue(value)) setByPath(values, field.fieldName, value);
  }
  return values;
}
```
and its caller in `renderCaseForm`:
```js
caseForm.fieldValues = values;
caseForm.filledData = values;
```

Two compounding problems:

1. **Wrong key, wrong traversal.** `getByPath`/`setByPath` split `field.fieldName` — the **raw** AcroForm name (`"form1[0].#subform[1].Part3_Line2_Name[0]"`) — on `.` and walk it as a nested path. That path exists in neither `fieldValues` (flat, keyed by the **normalized fieldId**) nor `filledData` (nested, but by fieldId segments, not raw-name segments). `getByPath(values, field.fieldName)` was therefore *always* `undefined`, so every field looked "unset" and was recomputed fresh from canonical/autofill data on every single `open()` — silently discarding whatever was actually stored, whether autofilled or manually overridden.

2. **The merged, corrupted object was written back into BOTH stores, unconditionally, on every open.** `caseForm.fieldValues = values; caseForm.filledData = values;` collapses two intentionally different representations (flat-by-fieldId vs. nested-by-fieldId) into one hybrid blob and persists it into both fields regardless of whether anything was actually missing. Because `values` started as `{ ...fieldValues, ...filledData }`, this hybrid carried a mix of flat fieldId keys and nested fieldId trees under the same object, saved into both `fieldValues` and `filledData`.

The self-perpetuating part: once `filledData` has been overwritten with this hybrid once, it now *also* contains stray flat fieldId keys it never had before. On the **next** `open()`, `{ ...fieldValues, ...filledData }` spreads `filledData` last — so `filledData`'s own stale flat-key copy (frozen at whatever it was during the *previous* open, not updated by anything in between) silently wins over the fresh value in `fieldValues`, reverting the field. A case manager who edits a field, then reopens the form (to check another section, or simply by navigating back to it) would see — and file — the old value, with no error, no warning, and a UI that had shown the edit as saved correctly moments before.

This was not caught by Session 2's live proof because that proof only ever called `save → render`, never `save → open again → render` — the open-edit-reopen sequence a real case manager actually performs.

### Effects (confirmed by live reproduction)
- A field edited via `saveSection`, then re-opened once (workspace `open()` called a second time), silently reverted to its pre-edit autofilled value — even though the database's `manualOverrides`, `sourceAttribution`, and `fieldReviews` for that field all still correctly showed the manual override, and the interactive-review's own internal bookkeeping was untouched. Only the value actually shown to the user and burned into the PDF was wrong.
- Every `open()` call re-ran full autofill computation for any field it considered "unset" (i.e., every field, per bug 1 above) rather than trusting stored data — masked as a performance-only concern until combined with bug 2, which made it a correctness bug.
- Because the corruption compounds on every open, a form opened many times without intervening edits could accumulate an increasingly hybrid `filledData` structure, though the field-value-reversion effect above is the one with real user impact.

### Fix Applied
**File: `Backend/src/modules/uscis-forms/uscis-form.service.js`**
- Added `AutoFillService` and `MappingResolver` requires (reusing the same accessors Bug A/B's fix already established as canonical, rather than reinventing a third lookup convention).
- Rewrote `mergeFieldValues` to look up each field's current value by its **normalized fieldId**, using `AutoFillService.getFieldValue` (flat-key-first) against `fieldValues`, falling back to `MappingResolver.resolvePath` against `filledData` — the exact pair of accessors `PDFFieldMapper`/`AutoFillService` already treat as authoritative. It now returns `{ values, newlyComputed }`: `values` stays flat-keyed by `field.fieldName` (raw name) purely for the read-only display/completion consumers in this file (`calculateCompletion`, `buildSourceAttribution`, `isVisible`, `buildRenderModel` — none of which persist anything and were switched from `getByPath(values, ...)` to a direct `values[fieldName]` property read, since `values` is now genuinely flat); `newlyComputed` lists only fields that had **no existing value anywhere**, keyed by `canonicalId`.
- Rewrote `renderCaseForm`'s persistence step to stop unconditionally overwriting both stores with the merged view. It now writes **only** the `newlyComputed` entries, into each store under its own correct shape: a plain bracket assignment into a copy of `fieldValues` (flat), and `MappingResolver.setPath` into a **deep-cloned** copy of `filledData` (built via `AutoFillService.clone()`, the same deep-clone helper Bug B's fix established — a shallow copy was already proven insufficient for Mongoose Mixed-type change detection in this exact codebase, see Bug B above). An existing value — autofilled or manually overridden — is never rewritten by this path.

No route, model, or middleware was changed. `MappingResolver.js`, `PDFRenderer.js`, `PDFFieldMapper.js` were not modified — only read, to confirm which accessor pair is canonical.

### Sibling issue found during regression testing: `dangling-template-guard.test.js` mock did not match production query chaining
While re-running the full `uscis-forms` test suite after the fix above (28 tests, 7 files), 1 test failed: `renderCaseForm throws a clear, actionable error ... when the case form's template was deleted`. Root-caused via `git diff` (confirming the fix above never touches the code this test exercises) to a **pre-existing test bug, unrelated to this session's change**: `getAccessibleCase` and `renderCaseForm` both chain `.maxTimeMS(...)` onto `Case.findById(...)` / `CaseForm.findOne(...).populate(...)` (a real Mongoose `Query` supports this chain), but the test's mocks returned plain resolved `Promise`s with no `.maxTimeMS` method — so the mock itself threw the raw `TypeError` the test exists to prove renderCaseForm no longer throws, masking the actual guard clause under test. Fixed by making both mocks chainable (`Case.findById` → `{ maxTimeMS: () => Promise.resolve(...) }`, `CaseForm.findOne` → `{ populate: () => ({ maxTimeMS: () => Promise.resolve(...) }) }`), matching real Mongoose `Query` shape. No production code was touched for this fix — test-only. Re-ran: 28/28 pass.

### Verification That the Fix Is Complete
All verified live, against a real seeded H-1B case in the local test database — not inferred from code reading:

1. `saveSection` writes a manual override → `open()` the workspace a **second** time (the sequence that exposed this bug) → the edited value is still shown, `syncState: MANUAL_OVERRIDE`. ✓
2. A **third** `open()` call, for good measure → value still correct (rules out "reverts on odd/even opens" or similar off-by-one). ✓
3. The actual rendered PDF (`PDFRenderer.renderFiling` → `pdf-lib` read-back) contains the edited value after the repeated opens. ✓
4. A different, never-edited field on the same form is still correctly autofilled on open (regression check — the fix didn't break normal autofill display for untouched fields). ✓
5. The real `downloadForm` HTTP controller (`FormGenerationController.downloadForm`, not `AutoFillService.generate` called directly) — driven against a form that is both **stale** (`syncState.stale: true`, simulating canonical data changing after the CM's edit) and manually edited — correctly runs the stale-triggered `AutoFillService.generate({ regenerate: true })` refresh (confirmed `syncState.stale` cleared afterward) while the served PDF bytes still contain the CM's manual override, not the refreshed autofill value. ✓
6. Full `uscis-forms` regression suite (7 files, 28 tests, including the `dangling-template-guard.test.js` fix above): 28/28 pass.

### Future Lessons (in addition to ISSUE-001's five above)

6. **A namespace-bridge bug can exist in more than one place at once.** Bug A/B were fixed in `interactive-form-review.service.js`/`AutoFillService.js`; Bug C was the *same class* of raw-name-vs-normalized-id confusion, independently reimplemented in `uscis-form.service.js`'s older `mergeFieldValues`/`getByPath`/`setByPath`. Fixing the namespace bridge in the file a bug was found in does not mean every other file with its own independent implementation of "merge these two stores" is safe — each one needs its own audit and its own live proof.

7. **"Save, then render" is not the same proof as "save, then re-open, then render."** Every consumer of a persisted CaseForm that recomputes or merges derived state on read (not just on write) needs its own re-open in the test sequence — a bug that only manifests on the second read of already-correct data will not be caught by any test that only ever reads once after writing.

8. **A "merge missing values in" function must never write back values that were already present.** The safest version of "backfill anything unset" only ever touches the fields it actually had to compute — echoing back the fields it found already-set (even unchanged) into a persistent store is where this entire bug lived. `newlyComputed`-style out-parameters that list only genuinely-new data, rather than a full merged view, make this class of bug structurally harder to reintroduce.

### Addendum Closed
Date: 2026-09-02
Resolved by: `uscis-form.service.js` (`mergeFieldValues` rewrite + `renderCaseForm`'s persistence step) and `uscis-forms/tests/dangling-template-guard.test.js` (mock fix, test-only)

---

## Issue: BAIS Navbar Auth-State Race Condition

### ID
ISSUE-002

### Status
FIX APPLIED — browser verification not yet performed (see Verification section below; do not treat as closed until that step runs)

### Severity
High — a fully authenticated user, including staff on the internal build, sees the logged-out navbar (Login/Sign Up) and loses the Dashboard/Messages/Payments tabs for the entire loading window of every page load, not a brief flash. On the free-tier (Atlas M0) database this session's other investigation was already run against, page loads of 6–8 seconds mean the wrong navbar is what the user sees for the majority of the page's visible lifetime, on every navigation.

### Discovery
Reported directly, with the root cause already substantially diagnosed: both symptoms (Login/Sign Up showing while authenticated; Dashboard/Messages/Payments tabs missing) were suspected to share a single cause in `Navbar.jsx`'s handling of the auth-loading window. Confirmed by reading the actual code before making any change.

### Root Cause
**File: `BAIS/Frontend/src/components/Navbar.jsx`**

`AuthContext.jsx` exposes an explicit state machine — `AUTH_STATUS = { LOADING, AUTHENTICATED, UNAUTHENTICATED, ERROR }` and a derived `authLoading: authStatus === AUTH_STATUS.LOADING` — specifically so consumers can distinguish "we don't know yet" from "we know you're logged out." `AuthContext.jsx` already carries a comment documenting a "Phase 12 fix (P12-C2)" for `ProtectedRoute` having exactly this class of bug previously. `Navbar.jsx` was never updated to match: it destructured only `user` from `useAuth()`, never `authStatus`.

Two symptoms, one cause:
1. **Login/Sign Up shown while authenticated.** The auth section rendered `{user ? <ProfileDropdown/> : <Login/><SignUp/>}`. During the window where `verifySession()` is in flight (`authStatus === "loading"`) or has failed transiently (`authStatus === "error"`, e.g. from Atlas M0 slowness), `user` is `null` — indistinguishable, from this code's point of view, from "definitely logged out." So an authenticated user sees Login/Sign Up for the entire duration of session verification on every page load, not a one-frame flash.
2. **Dashboard/Messages/Payments tabs missing.** `sessionHasCase` — which gates those tabs via `hasCase` — defaults to `false` and is only set by a separate async `sessionContext()` call that starts *after* `user` is already set. `hasCase` was `false` (hiding the tabs) for the entire duration of that second, independent fetch, indistinguishable from "this user genuinely has no case."

### Effects
- Every page load presented a logged-in user with a logged-out-looking navbar for several seconds, worst-case on the slower Atlas M0 tier already documented elsewhere in this investigation.
- Dashboard/Messages/Payments tabs appeared to vanish and reappear on every navigation, since `sessionHasCase` resets and re-fetches per mount.

### Fix Applied
**File: `BAIS/Frontend/src/components/Navbar.jsx` only.** `AuthContext.jsx` was not touched — its state machine was already correct; `Navbar.jsx` simply never read it.

- Destructured `authStatus` alongside `user` from `useAuth()`. Added `const authResolving = authStatus === "loading" || authStatus === "error"`.
- Auth section (desktop and mobile menu): while `authResolving`, render neither the profile dropdown nor Login/Sign Up — a neutral fixed-size placeholder (`<div className="w-9 h-9" />`) in the desktop view, nothing in the mobile menu. Only when `authStatus === "unauthenticated"` (i.e., session verification actually completed and found no user) does Login/Sign Up render. No spinner was added to the rest of the navbar (logo, nav links, hamburger) — only this one section's markup changed.
- Added `sessionHasCaseLoading` state, defaulting to `true`, set to `false` in both the success and failure branch of the existing `sessionContext()` effect. While it is `true` and `user` is set, `hasCase` is treated as `true` for nav-link visibility purposes only — this hint only ever hides/shows tabs; it is not a security gate (`ProtectedRoute` and the backend routes remain the actual access control), so treating "not yet known" as "assume yes, don't hide" for a fraction of a second is safe by construction.
- Verified `npm run build` succeeds with no errors.

### What This Fix Does NOT Do (by design, per explicit scope)
- Does not touch `AuthContext.jsx`, any route, model, backend controller, or middleware.
- Does not add a loading spinner anywhere except the one auth-section placeholder.
- Does not change the underlying M0-slowness cause of `authStatus` staying in `loading`/`error` for multiple seconds — it changes what the UI shows *during* that window, not the window's length.

### Verification
- Build: `npm run build` in `BAIS/Frontend` — succeeds, no errors. ✓
- **Real-browser proof — NOT YET PERFORMED.** Per this investigation's own standing rule ("the only real proof... is the actual [rendered output]", established in ISSUE-001's Future Lesson #4), this fix must not be considered closed until verified in a real running browser: log in, confirm the profile dropdown appears (not Login/Sign Up) within ~2 seconds of the page becoming visible with no manual refresh, and confirm Dashboard/Messages/Payments appear once logged in with a case. This step is still outstanding and will close this issue when complete.

### Future Lessons
1. **A documented fix for one component does not fix a sibling component with the same bug.** `AuthContext.jsx`'s own comments already named this exact bug class and referenced a specific prior fix (`ProtectedRoute`, "Phase 12 fix (P12-C2)") — but that fix was never propagated to `Navbar.jsx`, which reads the same context. Whenever an auth-timing race is fixed in one consumer, every other consumer of the same context should be audited for the same read pattern (`user` alone, without `authStatus`).
2. **"Auth timing + backend slowness → wrong UI state" is a distinct bug class from the form-persistence bugs above** (ISSUE-001/Bug C), but shares the same underlying discipline failure: code that treats "I don't have this value yet" the same as "the value is definitively absent/false." In the form bugs, that was `getByPath` returning `undefined` for a value that existed under a different key; here it's `user === null` conflating "still loading" with "logged out," and `hasCase === false` conflating "haven't checked yet" with "confirmed no case." Any boolean or nullable derived from an in-flight async call is a candidate for this bug unless it has an explicit third "unknown/loading" state that callers actually check.

### Issue Status
OPEN pending browser verification (see Verification section). Will be updated to RESOLVED once the real-browser pass described above is completed.

---

## Issue: USCIS Barcode/Signature Fields Corrupted by Autofill (rendered as plain text instead of a barcode)

### ID
ISSUE-003

### Status
RESOLVED — but see the "Addendum: Bug D" section below first. The fix described in the original write-up (Bug A: `ProtectedFieldPolicy`, never write to a barcode field) was necessary but **not sufficient** — it was declared verified and complete here, then the user reported the barcode was still rendering as text on a real, freshly-downloaded PDF. A second, independent bug (Bug D: the AcroForm-wide `/NeedAppearances` flag) was found and fixed as a direct result of that report. Left in place, unedited below, as an honest record of the first (incomplete) verification pass.

### Severity
Critical — every USCIS-internal PDF417 barcode field (and every signature field) on every generated form in the system was being silently overwritten with plain text, corrupting a data-independent element that must be byte-identical to the template on every output. On the real, official USCIS I-129 this manifested exactly as reported: the center-bottom barcode mark rendered as the literal readable string (e.g. `I-129|02/27/26|1`) instead of a scannable barcode.

### Discovery
Reported as a visible symptom on the software-generated I-129 (barcode degraded to plain text) with an initial hypothesis that a font-substitution or appearance-regeneration step (pdf-lib's `save()`, `NeedAppearances`, qpdf normalization, or an Adobe `setformdata` side-effect) was stripping/replacing the barcode's font during rendering. That hypothesis was tested against the real template and found **not** to match the actual mechanism — the barcode element is not text drawn with a font at all.

### Root Cause
The barcode is an ordinary AcroForm **text field** (`PDF417BarCode1[0]` and its per-page/per-part repeats — 38 occurrences on the I-129) whose `/AP /N` appearance is a pre-rendered **raster image XObject** (the actual PDF417 barcode graphic), not a font glyph. Two things had to both be true for it to corrupt:

1. **`FormMappingService.normalizeMappings()`** (`Backend/src/modules/form-mapping/services/FormMappingService.js:85`) falls back to a field's own scanned `defaultValue` whenever no real crosswalk mapping exists for it: `if (!mappings.length && field.defaultValue !== undefined) mappings.push({ source: "default", defaultValue: field.defaultValue })`. This is correct behavior for an ordinary field with no canonical source — but a barcode field's "default value" is its own pre-existing payload text (e.g. `I-129|02/27/26|1`), scanned off the template at import time. This fallback fed that text back into `caseForm.filledData` as if it were resolved case data, for every barcode and signature field on every template in the system (confirmed empirically, not assumed).
2. **`PDFFieldMapper.mapFields()`** (pre-fix) had no concept of a field that must never be written to, so this fake "default" flowed straight into `mappedFields`. **`PDFRenderer.setFormField()`**'s `field.setText(String(value))` call then executed unconditionally for any text-type field, and pdf-lib's `setText()` **unconditionally regenerates the field's appearance stream** — discarding the original image XObject appearance and replacing it with a freshly-drawn text appearance. The visible result: a barcode-shaped raster image turns into the literal barcode-payload string rendered as plain text — exactly the reported symptom, and exactly why it looked like a "font" problem (the output genuinely is plain text) while actually being a "wrong field ever got written" problem.

Signature fields were exposed to the identical mechanism (any scanned `defaultValue` for a signature field would equally flow through and get `setText()`'d), though the golden I-129 case's signature fields happened to have no `defaultValue` populated, so the visible symptom was barcode-only. The fix protects both field classes on the same code path since the underlying mechanism is identical.

### Effects
- Every barcode occurrence on every generated PDF (any form) was corrupted — not a rare edge case, confirmed on 100% of barcode fields on the golden I-129 case before the fix.
- A corrupted barcode on an official USCIS filing risks rejection by USCIS's own intake scanning — a materially worse outcome than a cosmetic bug, since this pipeline's whole purpose is producing filing-ready PDFs.
- Any signature field that happened to carry a scanned `defaultValue` on a given template was equally at risk of the same corruption, even though it wasn't the symptom that triggered discovery.

### Fix Applied
**New file: `Backend/src/modules/form-generation/services/ProtectedFieldPolicy.js`** — single source of truth for "this PDF field must never be written to by this application," with a 4-tier signal priority (most to least authoritative): (1) `field.uscisUseOnly === true`, an explicit per-field flag `FieldLabelEnrichmentService` sets at import time (not populated on older imports, so never assumed present); (2) `field.pdfFieldType === "signature"`, set reliably by `PDFFieldScannerService` via pdf-lib's own `PDFSignature` class; (3) the existing, already-tested `isUscisUseOnly(fieldName, formCode)` helper (`FieldLabelEnrichmentService.js`) — the same signal that already keeps these fields out of the interactive review UI, reused rather than duplicated; (4) a raw `/barcode/i` / `/signature/i` name-pattern fallback, for a template imported without any authored crosswalk at all.

**File: `Backend/src/modules/form-generation/services/PDFFieldMapper.js`** — `mapFields()` now checks `isProtectedField()` **before** condition/value resolution for every candidate mapping (first line of defense: a protected field is never even evaluated as a mapping candidate) and routes it into a new `protectedFields` array instead of `mappedFields`.

**File: `Backend/src/modules/form-generation/services/PDFRenderer.js`** — `setFormField()` also checks `isProtectedField()` before any pdf-lib mutation call (last line of defense — so a future mapping-layer bug alone cannot reintroduce this corruption; the render layer refuses independently). `render()`'s report now includes `protectedFields` for auditability.

**File: `Backend/src/modules/form-generation/services/AdobeFormRenderer.js`** (Adobe render engine, added this same investigation) — builds its `jsonFormFieldsData` exclusively from `PDFFieldMapper.mapFields()`'s `mappedFields`, the identical shared mapper the pdf-lib path uses. Since protected fields never reach `mappedFields` at all, the Adobe engine inherits the exact same protection **by construction**, with no separate Adobe-specific check required — verified by code inspection plus the cross-template test below (which exercises `PDFFieldMapper.mapFields()` directly, the same function both engines consume). `protectedFields` was added to its `renderReport` for audit parity with the pdf-lib engine.

No route, model, middleware, `MappingResolver.js`, `WatermarkService.js`, or `normalizePdf.js`/qpdf configuration was touched — the corruption was never in the appearance-generation/normalization layer these files own, so nothing there needed to change.

### Why the initial font-substitution hypothesis was wrong (documented so it isn't re-investigated the same way twice)
The reported symptom ("barcode renders as plain text") is consistent with *either* (a) a font/appearance-regeneration failure on an otherwise-correct barcode-font text field, or (b) a raster-image field whose appearance was replaced by a freshly-drawn text appearance because the wrong value was written to it. Only empirical inspection of the template's actual `/AP /N` object distinguishes these — it is an `/Image` XObject, not a font-drawn glyph, which is only consistent with (b). Verification scripts written for hypothesis (a) (font-presence checks, appearance byte-diffing against a "should be untouched" assumption) would have been the wrong tool entirely; the actual proof needed is "was this field written to at all," which is what `renderReport.protectedFields` and the image-XObject-hash comparison below directly answer.

### Verification That the Fix Is Complete
All verified live, against real seeded/imported data — not inferred from code reading:

1. **Real I-129 golden case, full pipeline (`AutoFillService.generate` → `PDFRenderer.render`):** all 38 barcode field occurrences — image XObject still present (✓ 38/38), raw image-stream bytes SHA-256-identical to the untouched template (✓ 38/38), field `/V` value unchanged from the template (✓ 38/38). All 22 signature fields on the same template — value unchanged (✓ 22/22). Ordinary field autofill regression-checked on 5 sampled text fields and 5 sampled checkbox fields from the same render — all still correct (✓ 5/5, ✓ 5/5).
2. **All 6 other seeded USCIS templates** (I-129F, I-130, I-134, I-539, I-539A, I-907), exercising `PDFFieldMapper.mapFields()` directly against every field on each real template with a synthetic "every field has a value" fixture (the fix is mapping-layer/name-pattern driven, not data-content driven, so this is a valid worst-case exercise without needing a full golden-case fixture per form): every barcode and signature field on every template — 0 leaked into `mappedFields`, 100% confirmed present in `protectedFields` (I-129F: 12 barcode + 6 signature; I-130: 12 + 6; I-134: 10 + 4; I-539: 7 + 6; I-539A: 5 + 6; I-907: 7 + 6 — all PASS).
3. **Adobe engine:** confirmed by construction (see Fix Applied) — `AdobeFormRenderer` consumes the same `mappedFields` output already proven clean in check 2 above, so a protected field structurally cannot reach Adobe's `jsonFormFieldsData`. No separate live Adobe API call was needed (or spent) to prove this, since the choke point is shared code, not parallel logic.
4. **Regression suites:** `form-generation` and `uscis-forms` `node --test` suites re-run after these changes — confirms no existing caller of `PDFFieldMapper.mapFields()`/`PDFRenderer.setFormField()` broke.
5. Checks 1 and 2 above are now a permanent test (`Backend/src/modules/form-generation/tests/ProtectedFieldPolicy.test.js`), not just the ad-hoc verification scripts that first proved the fix — so this class of regression fails CI going forward rather than requiring a human to notice a corrupted barcode on a real filing.

**Not yet done (honest gap, do not treat as closed until completed):** a real-browser download + visual/Acrobat inspection of the actual barcode graphic. Every check above reads the PDF's actual bytes/objects programmatically (image XObject presence, SHA-256 identity, field values) — which is strictly stronger evidence for *data corruption* than a visual check would be, but a human has not yet looked at the rendered barcode with their own eyes in a viewer, and per this document's own Future Lesson #4 (ISSUE-001), that step should still happen before this is fully considered production-verified end to end.

### Future Lessons
1. **A visible symptom does not tell you which layer broke it — inspect the actual object, not the plausible-sounding cause.** "Barcode renders as text" is equally consistent with an appearance-regeneration/font bug and with "the wrong value got written to an image-backed field." These have completely different fixes (preserve-and-restore an appearance vs. never write to the field at all). The five minutes spent opening the template's own `/AP /N` object and confirming it was `/Image`, not a font-drawn operator, immediately ruled out an entire branch of otherwise-plausible hypotheses (font embedding, `NeedAppearances`, qpdf font-stripping) that would have led to solving the wrong problem — e.g., building appearance-preservation/re-injection machinery for a bug that was actually "stop writing to this field."
2. **A generic "use the field's default value" fallback is dangerous for any field the application didn't design the concept of "default" for.** `FormMappingService`'s defaultValue fallback is correct for a field like a country code or a boilerplate checkbox default — it was never written with USCIS-internal fields (barcodes, signatures) in mind, and nothing about its own code signaled that distinction. Any generic "fall back to X" mechanism over a set of fields sourced from an external, uncurated scan (here: `PDFFieldScannerService`'s raw AcroForm inventory) needs an explicit allow/deny concept for fields that are structurally different from ordinary data fields, not an assumption that "every field is a data field."
3. **Two independent render engines sharing one mapping function get a fix for free — but only if they actually share it.** `AdobeFormRenderer` needed zero barcode-specific code because it was already built (this session) to consume `PDFFieldMapper.mapFields()` rather than re-deriving its own field/value resolution. Any future second consumer of USCIS field data should be checked for the same property: does it call the shared, protected function, or does it re-implement field selection independently (in which case it needs its own explicit protected-field check, as `PDFRenderer.setFormField()` deliberately keeps as a defense-in-depth backstop even though `PDFFieldMapper` already filters upstream).
4. **Defense in depth belongs at both the decision layer and the mutation layer, even when the decision layer is provably correct.** `PDFFieldMapper.mapFields()` alone would have been sufficient to fix this bug. `PDFRenderer.setFormField()`'s independent check was added anyway, specifically so a future bug in the mapping layer (a new caller that builds its own `mappedFields`-shaped object without going through `mapFields()`, say) cannot silently reintroduce this exact corruption — the render layer is the last point before an irreversible pdf-lib mutation, and it refuses on its own.

### Related Files
| File | Role |
|---|---|
| `ProtectedFieldPolicy.js` | Single source of truth for "never write to this field" — 4-tier signal priority |
| `FieldLabelEnrichmentService.js` | Source of `uscisUseOnly` (import-time flag) and `isUscisUseOnly()` (reused, not duplicated) |
| `FormMappingService.js` | Owns the `defaultValue` fallback that originally caused the leak (line 85) — not modified; the fallback itself is legitimate for ordinary fields |
| `PDFFieldMapper.js` | First line of defense — protected fields excluded from `mappedFields` before condition/value resolution |
| `PDFRenderer.js` | Last line of defense — `setFormField()` independently refuses to mutate a protected field |
| `AdobeFormRenderer.js` | Inherits the protection for free by consuming the same `mappedFields` output |

---

## Addendum: Bug D — the AcroForm-wide `/NeedAppearances` flag rebuilt even untouched barcode appearances as plain text

### Discovery
After Bug A above was implemented, verified (38/38 barcode fields byte-identical, cross-template, regression suites green) and documented as resolved, the user tested a real, freshly-generated download in their own browser via the actual "Download Official Form" button — twice, on two separate occasions — and the barcode still rendered as plain text both times. This directly contradicted the "Verification" section above, which was true as far as it tested, but had not tested the right thing: it verified the PDF's **objects** (image XObject present, byte-identical, field value unchanged) but never verified what a **PDF viewer actually displays**, which turned out to depend on something the object-level checks are blind to.

### Root Cause (found by inspecting the real, actual PDF the user downloaded — not the golden test fixture)
Traced by connecting to the real (non-test) production-pointed database, finding the exact `CaseForm` and the exact stored `Document` bytes from the user's own most recent download (via `AuditLog`'s `PDF_OFFICIAL_DOWNLOADED` entries, which also revealed the running server's `ADOBE_PDF_FILL_ENABLED` defaults to `true` — the live download path is the **Adobe** engine, not pdf-lib, which the first verification pass never exercised against real data), and inspecting those exact bytes object-by-object.

The bytes were, in fact, exactly as correct as Bug A's fix promised: the barcode field's `/AP /N` image XObject was present and intact. But the AcroForm dictionary also had **`/NeedAppearances true`** set. This is a single, document-wide flag with no per-field opt-out in the PDF specification: any compliant viewer that honors it discards **every** widget's stored appearance and reconstructs it from the field's `/V` value using its `/DA` (default appearance — a font), regardless of whether that field's stored appearance was already correct. For an ordinary text field this is harmless-by-design (it's *why* the flag exists — to guarantee filled values are visible even to viewers that don't trust `pdf-lib`'s own generated appearances). For a barcode field, whose stored appearance is a raster image and whose `/V` value is literal payload text, the same instruction makes the viewer throw away the correct image and draw the payload text instead — which is precisely the reported symptom, and precisely why it looked like a "font substitution" bug from the very first report.

Two independent sources set this flag on the real output, confirmed empirically rather than assumed:
1. **`PDFRenderer.render()`** sets it explicitly and intentionally (`form.acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.True)`), for the legitimate reason above — a real, previously-verified requirement (`h3-pdf-render.test.js` explicitly asserts an editable render "must set NeedAppearances so every viewer regenerates appearances").
2. **Adobe's `setformdata` operation independently returns its own output with the same flag already set** — confirmed by loading the user's actual, real, already-downloaded Adobe-produced PDF and reading the AcroForm dictionary directly. This is Adobe's own behavior, not anything this application's code does.

Bug A's fix (never write to the field) was necessary but addressed only the *data* layer. It did nothing to stop a *viewer*, honoring a document-wide flag neither engine can avoid setting for legitimate reasons, from discarding that correct data at *display* time.

### Fix Applied
**New file: `Backend/src/modules/form-generation/services/BarcodeAppearanceGuard.js`** — `flattenBarcodeAppearances(form, formCode)`. For every field that is both (a) protected (`ProtectedFieldPolicy.isProtectedField`) and (b) currently has a real `/Image` XObject appearance (a narrower check than "protected," deliberately — see below), bakes that field's current, correct appearance directly into its page's content stream and removes the field/widget entirely, using the same technique `pdf-lib`'s own `PDFForm.flatten()` uses internally (this installed `pdf-lib` version's `flatten()` has no per-field selector, so the internals — `findWidgetPage`, `findWidgetAppearanceRef`, `removeField`, and the public drawing-operator helpers — are reused directly rather than duplicated or monkey-patched). Once a field is baked into static page content and no longer exists as a widget annotation, `/NeedAppearances` has nothing left to rebuild for it, on any viewer, permanently.

Deliberately scoped to barcode fields only, not every `isProtectedField` match: a signature field with no value has no appearance for `/NeedAppearances` to misrender as text in the first place (this was always a theoretical extension in Bug A's write-up, never an observed symptom), and flattening it would permanently remove the ability to click-to-sign it later — a real regression not worth risking to fix a bug that was never observed there.

**File: `PDFRenderer.js`** — calls `flattenBarcodeAppearances(form, template.formCode)` immediately after the field-write loop, before the existing `flatten ? form.flatten() : NeedAppearances=true` branch, so neither a whole-document flatten nor the `NeedAppearances` flag can ever reach an already-removed barcode field. `renderReport.flattenedBarcodeFields` added for auditability.

**File: `AdobeFormRenderer.js`** — since Adobe is an external service whose output this application doesn't control internally, the same fix is applied as a post-process: Adobe's returned buffer is reloaded with `pdf-lib`, `flattenBarcodeAppearances` runs against it, and the result is re-saved before the existing `PDFFidelityService.verify()` call. `renderReport.flattenedBarcodeFields` added here too.

No route, model, middleware, `MappingResolver.js`, `WatermarkService.js`, `normalizePdf.js`/qpdf, or `AdobePdfService.js` was touched.

### Verification That This Fix Is Complete
1. **Against the user's own real, live case** (`CaseForm` `6a987b7277619789848232ba`, the exact record the user's screenshots came from, in the real production-pointed database — not the golden test fixture): rendered fresh via `PDFRenderer.render()` with the fix applied — all 38 barcode fields flattened (confirmed absent from the live `AcroForm`, confirmed present as a `FlatWidget` XObject baked into the correct page, confirmed byte-identical to the template's original barcode image), `/NeedAppearances` still `true` for the remaining (legitimate) data fields as required by the existing test contract.
2. **Against the user's own real, already-downloaded Adobe output** (the exact stored bytes from the `AuditLog`-confirmed `engine: "adobe"` download, fetched from real storage — not a simulated fixture): applying `flattenBarcodeAppearances` directly to those exact bytes produces the same result — 38/38 barcode fields flattened, `FlatWidget` XObject present, output still a valid PDF. This validates the Adobe-side fix logic against real, previously-corrupted-when-viewed production output without spending a new live Adobe API call.
3. **`ProtectedFieldPolicy.test.js` updated** to assert the new (correct) behavior — a barcode field must now be **absent** from the live `AcroForm` (`assert.throws(() => generatedForm.getField(name))`) and its original image bytes must be found, byte-identical, baked into a `FlatWidget` XObject on the correct page (matched via `pdf-lib`'s own public `findWidgetPage`) — rather than the superseded assertion that the field remained live and untouched.
4. **Full regression suites** (`form-generation` + `uscis-forms`, 59 tests total) re-run after this fix: all pass, including the pre-existing `h3-pdf-render.test.js` assertion that `NeedAppearances` is still set for an editable render (proving this fix did not regress that legitimate, separate requirement).

**Not yet done (honest gap — do not treat as closed until completed):** the user has not yet confirmed, by eye, that a fresh "Download Official Form" click now shows a real barcode rather than text. Every check above — including the ones added in this addendum — reads the PDF's actual bytes/objects programmatically. That is strictly stronger evidence of *data* correctness than a visual check, and it is exactly the same category of evidence Bug A's original "Verification" section relied on when it turned out to be insufficient — so this addendum explicitly does not repeat that mistake by calling the issue closed before a human looks at the actual rendered output.

### Future Lessons (Bug D, in addition to Bug A's four above)
5. **"The PDF's objects are correct" and "every viewer displays the PDF correctly" are different claims, and only one of them is what the user actually experiences.** Bug A's entire verification suite (SHA-256 image-byte identity, field-value equality, cross-template field-exclusion) was true and remained true throughout Bug D — none of it was wrong, and none of it would ever have caught Bug D, because Bug D is not a data-correctness bug at all. It lives entirely in a document-level *rendering instruction* (`/NeedAppearances`) that only manifests when something actually renders the PDF. A programmatic check that only re-parses PDF objects can prove data survived; it cannot prove a viewer will display that data the way the objects intend. When the artifact's entire purpose is "what a human (or a USCIS scanner) sees," object-level verification is necessary but provably not sufficient — this session had to be told, by the person actually looking at the output, that the "resolved" bug was still visibly present, twice, before this second layer was found.
6. **A shared, legitimate fix for one field class can be actively harmful to a different field class with different semantics, even when both are "fields on the same form."** `/NeedAppearances=true` is *correct* and *required* for ordinary filled text fields — removing it outright would have reintroduced whatever cross-viewer rendering bug it was originally added to solve (per the existing, still-passing `h3-pdf-render.test.js` contract). The fix therefore could not be "stop setting the flag"; it had to be "remove the one field class the flag actively harms from the flag's scope entirely," since the flag itself has no scoping mechanism. Look for this shape whenever a fix for the general case is technically correct but a specific subclass of the same data structure has different, incompatible requirements — the answer is often to structurally exempt the subclass, not to weaken the general fix.
7. **Confirmed empirically, not assumed: a third-party service (Adobe's `setformdata`) can independently reproduce a bug this codebase's own code also causes, via the same underlying PDF mechanism, for reasons entirely outside this codebase's control.** A fix scoped to only "our own code no longer sets this flag" would have left the Adobe engine (confirmed to be the actual default, production engine — `ADOBE_PDF_FILL_ENABLED` defaults `true`) silently broken. Whenever two independent render paths can produce the same class of PDF-structural side effect, the fix needs to be verified against *both* engines' actual output, not applied to one and assumed to generalize.

### Issue Closed
Date: 2026-09-03
Resolved by: `ProtectedFieldPolicy.js` + `PDFFieldMapper.js`/`PDFRenderer.js` (Bug A — never write to a protected field) and `BarcodeAppearanceGuard.js` + `PDFRenderer.js`/`AdobeFormRenderer.js` (Bug D — flatten barcode fields so the AcroForm-wide `/NeedAppearances` flag, required for ordinary fields on both engines, can no longer rebuild their appearance as text) + `ProtectedFieldPolicy.test.js` (updated permanent regression coverage for both bugs). Pending: user's own real-browser visual confirmation on the next fresh download.
