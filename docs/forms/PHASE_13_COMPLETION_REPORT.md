# PHASE 13 — CASEFORMS BELONG TO THE CASE, NOT THE QUESTIONNAIRE

**Status: COMPLETE, narrow scope.** The large "PHASE 13 (DEFINITIVE)" agent prompt this phase started from assumed a codebase state that no longer matches reality. Investigation (Part 0) found most of what it asked for already built; the one real, confirmed gap was fixed with a 4-file, ~120-line change plus two one-line bug fixes it exposed. No new PDF-artifact architecture was introduced.

---

## 0. Why this phase is smaller than its own prompt

The originating prompt assumed:
- A raw-XFA-key vs. sanitized-key mismatch between bulk autofill and interactive edits (its "F-1 bug"), requiring a new shared `normalizeXfaFieldKey()`.
- A primitive canonical-sync mechanism needing to be built from scratch (its "Phase 11").
- No CaseForm provisioning mechanism, requiring a new `ensureCaseForms()`/`determineRequiredForms()`.
- A missing "Artifact 2" — a persisted, hash-tracked, byte-mutated working-copy PDF in S3 that every field edit rewrites.

Direct code investigation found:
- `AutoFillService.generate()` and `AutoFillService.overrideField()` (called by `saveField()`) already write to `fieldValues` under the identical key — no dual key format exists. The F-1 bug described in `PHASE_12_COMPLETION_REPORT.md` is not present in the current code.
- `SyncStateService.js` (SYNCED/MANUAL_OVERRIDE/CONFLICT) plus `AutoFillService.overrideField()`'s reverse-sync, sibling fan-out, and conflict detection is a complete, working system.
- `uscisFormService.ensureAssignedForms()` already exists, is idempotent (checks existing `formCode`s before creating), already resolves conditional forms (I-907/G-28/I-539/I-539A) from real case state, and already has test coverage (`h1b-golden-path.test.js` T2/T4/T5).
- There is no persisted, mutated working-copy PDF anywhere in this codebase. `CaseForm.fieldValues`/`filledData` (JSON) is authoritative; the actual PDF is rendered on demand (`form-generation/services/PDFRenderer.js`) from that JSON. Building a mutate-on-every-edit S3 PDF would be a genuine architecture change, not a gap-fill, and was explicitly out of scope.

The one real, confirmed gap: `ensureAssignedForms()` was only ever invoked from inside `CaseLifecycleOrchestrator.generateForms()`, which hard-gated on `questionnaireComplete && documentsComplete && documents.reviewComplete` before creating any CaseForm at all. A CaseForm genuinely did not exist until a case manager clicked "Generate USCIS Forms" *and* every readiness gate had already passed — matching the prompt's actual complaint.

---

## 1. The fix

**`Backend/src/modules/cases/case-lifecycle-orchestrator.service.js`**
- Added `provisionRequiredForms(caseData, user, req)`: resolves the actual filing case(s) — each child case for an employer_employee/family structure (the principal is a container record), or `caseData` itself for a `single` structure — and calls the existing `ensureAssignedForms()` on each. Never throws (catches and logs, matching the existing knowledge-engine-orchestration pattern in the same function) so a template-configuration problem can't block case creation.
- Wired into `initializeCase()` (runs immediately after case creation, before any client/questionnaire/document exists) and `onAssignment()` (recovery/safety-net — a no-op in the normal case, since `initializeCase()` already provisioned).
- Restructured `generateForms()`: removed the three hard-blocking throws (`QUESTIONNAIRE_INCOMPLETE`, `DOCUMENTS_INCOMPLETE`, `DOCUMENT_REVIEW_INCOMPLETE`) and the dead-end early return that used to skip autofill entirely whenever a CaseForm already existed (correct under the old design, where "already exists" only ever meant "this same endpoint already ran once"; incorrect now that forms are provisioned earlier — it would have made the button a permanent no-op). `generateForms()` is now exclusively the autofill step: ensure any still-missing form exists (idempotent, e.g. a newly-conditional I-539), then autofill every form from whatever canonical data currently exists. Kept the genuine conflict gate (`hasUnresolvedConflicts` — real disagreement between two data sources) blocking, since autofilling a field known to conflict would write bad data; split it apart from `hasCanonicalErrors` (missing-required-field completeness, exactly the kind of gate this phase removes), which is now reported informationally instead of blocking.

**`Backend/src/modules/uscis-forms/uscis-form.service.js`**
- Hardened `ensureAssignedForms()`'s create loop against a race: two concurrent provisioning calls (now a real possibility with two call sites instead of one) can both pass the "does not exist yet" check for the same `(caseId, formTemplateId)` before either writes. `CaseForm`'s own unique index already rejects the loser with `E11000`; the loop now catches exactly that code and treats it as an already-provisioned no-op instead of letting a legitimate race look like a caller-facing failure.

## 2. Two pre-existing bugs found and fixed along the way

Both were unreachable before this phase — no test exercised `CaseLifecycleOrchestrator.generateForms()` directly (confirmed by grep: zero references outside `case.controller.js`/`case-workflow-automation.service.js`), and in the old flow `generateForms()` was only ever reachable after every completion gate had already passed, by which point a case's canonical profile had typically been built and any real conflict already resolved through other paths. Making `generateForms()` reachable much earlier in the lifecycle — the actual point of this phase — surfaced both:

- **`CanonicalProfileService.validate()`** read `caseRecord` once, then — only on a case whose canonical profile had never been built — called `this.rebuild()`, which loads and saves its *own* separate copy of the same document. `validate()` then kept mutating and saving its now-stale, pre-rebuild `caseRecord`, throwing a Mongoose `VersionError` on every first-ever validation of a fresh case, and silently overwriting the profile `rebuild()` just persisted with the stale copy on any run that didn't crash outright. Fixed: re-fetch the document once after `rebuild()` returns, only on that branch.
- **`CaseLifecycleOrchestrator.metrics()`/`calculateProgress()`** computed "unresolved conflicts" via `conflict.resolved` — a boolean field nothing in the codebase ever sets. Every other conflict consumer (`CanonicalValidationService`, `CanonicalController`) correctly checks `conflict.status === "pending_review"`. Since `resolved` was always `undefined`, every conflict ever recorded counted as permanently unresolved, regardless of actual resolution — which meant `generateForms()` would refuse to run again forever after a single staff override, even after the conflict was explicitly resolved through the real conflict-resolution endpoint. Fixed both occurrences to match the established `status`-based convention.

## 3. Verification

New test: `Backend/src/modules/cases/tests/case-lifecycle-form-provisioning.test.js` — end-to-end against the real pipeline (no mocks), proving all six required scenarios:

1. A bare `Case` with zero `Answer`/`Document`/questionnaire records gets an I-129 `CaseForm` immediately from `provisionRequiredForms()` alone.
2. Concurrent + repeated provisioning calls (`Promise.all` of three separate calls) never create a second `CaseForm` for the same `(caseId, formTemplateId)`.
3. `generateForms()` no longer throws on an unanswered questionnaire, and actually runs autofill against the pre-provisioned form (`generated.length === 1`) rather than returning it untouched.
4. Answering one real questionnaire field afterward and calling `generateForms()` again autofills the *same* `CaseForm` (still exactly one I-129 `CaseForm`; the new value is visible in `fieldValues`).
5. A case-manager manual override (`AutoFillService.overrideField`) is reflected immediately, correctly puts the field into `pending_review` conflict (staff value outranks the database value, unchanged Phase 11 behavior), correctly blocks a further blanket `generateForms()` run until that conflict is addressed, and — once resolved through the real `CanonicalProfileService.resolveConflict()` — unblocks `generateForms()` again without losing the override or creating a duplicate form.
6. Editing a field through the real `InteractiveFormReviewService.saveField()` path and reloading the `CaseForm` fresh from the database (simulating close/reopen) shows the saved value — the existing field-value-first persistence path, no new PDF artifact of any kind.

Regression (all run against the real pipeline/DB, not mocked):
- `h1b-golden-path.test.js` — 4/4 (unchanged; still the primary end-to-end gate)
- `case-lifecycle-orchestrator.test.js`, `case-gating.test.js`, `case-reassignment.test.js`, `case-lifecycle-routes.test.js` — 15/15
- `canonicalFieldWriter.phase11.test.js`, `SyncStateService.test.js`, `phase3.fanout-invariant.test.js`, `AutoFillService.overrideField.reverseSync.test.js`, `AutoFillService.overrideField.k1k3-fanout.test.js`, `interactive-form-review.*.test.js` (all three), `CanonicalMergeService.test.js`, `phase0.invariants.test.js` — 50/50
- `dangling-template-guard.test.js`'s one pre-existing failure was confirmed (via `git stash` of this phase's changes and re-running) to fail identically before this phase touched anything — unrelated, not introduced or fixed here, left alone per scope.

## 4. What was explicitly not done

- No `normalizeXfaFieldKey()` was created — there was nothing to normalize.
- No new canonical-sync/conflict/override mechanism was created — Phase 11's existing one was reused exactly as instructed, with two one-line bug fixes (§2) rather than a rewrite.
- No `workingPdfS3Key`/`sourcePdfHash`/`currentPdfHash` fields were added to `CaseForm`, and no PDF bytes are written to storage on field save. The field-value-first architecture (JSON authoritative, PDF rendered on demand) is unchanged.
- RBAC/route middleware was not touched anywhere; `case-lifecycle-routes.test.js` and `interactive-form-review.routes.test.js` (unchanged assertions) still pass.
