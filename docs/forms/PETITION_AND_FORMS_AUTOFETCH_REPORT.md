# Petition No-Criteria Drafting + USCIS Form Auto-Fetching

**Date:** 2026-09-27 – 2026-09-28
**Status:** COMPLETE

## 0. Objective

Two related asks, both about removing artificial gates on when things start existing:

1. Petitions should start drafting at case creation, with no readiness criteria, and fill in incrementally as documents/forms get approved.
2. Every USCIS form applicable to a visa type — not just the ones tagged `AUTO_CREATE` — should actually appear on a case and be autofillable, self-healing from uscis.gov when the local template is missing.

---

## 1. Petition drafting — no criteria

**`Backend/src/modules/petition/services/PetitionAssemblyService.js`**
- `assemble()` no longer aborts when `PetitionValidationService.validate()` returns `blocked`. It always builds the full heading structure from the case's `PackageDefinition` — cover letter, every required form/certification/letter slot — using placeholders (no `documentId`/`storageKey`) for anything not yet approved. Package status becomes `needs_revision` (missing pieces) or `assembled` (everything present), never aborts to nothing.
- Added `autoSync(caseId, user, req)`: non-throwing wrapper used by the new automatic triggers below; no-ops silently if the case's visa type has no active `PackageDefinition`.
- New `buildFormSections()` helper: one placeholder-or-real entry per required form, independent of whether a `CaseForm`/generated PDF exists yet.
- `resolveCertificationDocuments()` now returns one entry per required certification always (`doc: null` when missing), instead of filtering missing ones out.

**`Backend/src/modules/cases/case-lifecycle-orchestrator.service.js`**
- `initializeCase()` now calls `provisionPetitionDraft()` (mirrors `provisionRequiredForms()`'s child-case target resolution for employer_employee/family structures) right after form provisioning — a petition draft exists the moment a case is created.

**`Backend/src/modules/documents/document.workflow.service.js`** and **`Backend/src/modules/uscis-forms/interactive-form-review.service.js`**
- `documentReviewed()` (on approval) and `formDecision()`/`setLock()` (on form approval/lock) each call `PetitionAssemblyService.autoSync()` — every subsequent approval re-assembles the petition automatically, replacing placeholders with real content. `finalize()` (unchanged) remains the one gated action — still refuses on a blocked validation, so filing readiness is never compromised.

## 2. USCIS form auto-creation + self-heal fetching

**`Backend/src/modules/form-registry/visaFormMapping.service.js`**
- `registryAutoCreateTemplates()` now treats `CONDITIONAL` and `LATER_STAGE` registry mappings the same as `AUTO_CREATE` — a form is auto-created for a case the instant its template is available, no case-manager click, no case-stage gating. An explicit `NOT_APPLICABLE` decision on a `CONDITIONAL` mapping is still respected (a real opt-out, not a readiness gate).
- Added a throttled (1-hour cooldown, per formCode, in-process) self-heal: when a mapping resolves to `TEMPLATE_MISSING`, a background, non-blocking call to `OnDemandFormAcquisitionService.ensureCurrentUSCISForm()` fetches it from uscis.gov. Deliberately uses the non-forcing entry point (not `acquireForCase`, which would recurse back into this same resolution path).
- `Backend/src/modules/uscis-forms/uscis-form.service.js`: `latestTemplatesByAssignmentRules`/`ensureAssignedForms` now thread `user`/`req` through to the above.

**Live verification (not simulated):** ran the acquisition service directly against uscis.gov and fetched **I-829** and **I-956F** — both downloaded, qpdf-normalized, field-scanned, and stored as real `USCISFormTemplate` documents. **DS-117** was correctly rejected (Department of State form, not fetchable from uscis.gov) — confirms the agency gate holds.

## 3. Frontend fix: external link vs. in-app viewer

**`Admin/frontend/src/pages/CRMCaseDetail.jsx`** — the "Other Forms" table's "View on USCIS.gov" external link was rendered unconditionally next to the real in-app "Open (Biographic Autofill)" button, for every `BIOGRAPHIC_READY` row (exactly the state a freshly-fetched form sits in). Case managers were very likely clicking the external link instead of the in-app one. Fixed: the external link now only shows when there's no `CaseForm` yet (nothing in-app to open).

## 4. Verification

- `MappingGraphService.test.js`, `form-registry` suite (26–35 tests across runs), `case-lifecycle-orchestrator.test.js`, `immigration-knowledge-engine.test.js` — all passing.
- Confirmed via `git stash` isolation that one pre-existing, unrelated test failure (`case-lifecycle-form-provisioning.test.js`'s staff-override-conflict assertion) already failed identically on the base branch before any of this work — not introduced or fixed here.

## 5. What was explicitly not done

- No bulk/unattended fetch of every missing form code at once — the self-heal is per-form, throttled, triggered by real demand, matching the codebase's own documented caution against unattended uscis.gov scraping.
- Mapping *activation* (full production autofill trust) is not part of this work — see `FORM_GOVERNANCE_PAGE_REPORT.md` for that gate and why it stays human-reviewed.
