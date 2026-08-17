# Module Cards — High-Centrality / Business-Critical Nodes

Scope note: cards are provided for every node that either (a) exceeds a qualitative "touches 5+ other confirmed-finding nodes" threshold, or (b) is manually classified business-critical (Case, User, CaseForm, USCISFormTemplate, AuthSession, the errorHandler classifier). This is not a claim of exhaustive coverage of all 64 models — see `COVERAGE.md` for what is and isn't covered.

---

### MODULE: Case (model)
**File**: `Backend/src/models/Case.js`
**Collection**: `cases`
**Declared indexes**: 127 (including implicit field-level) — **exceeds MongoDB's 64-per-collection hard limit**; positions 65-128 (all explicit compound + text indexes at lines 851-897) do not exist on the live collection.
**Direct consumers (services)**: case.service.js, case.controller.js, case-lifecycle-orchestrator.service.js, CollaborationService.js + TimelineService.js, CanonicalProfileService.js, EligibilityEngineService.js, AutoFillService.js, workflow.service.js, ImmigrationTimelineService.js — 9 distinct services.
**Frontend consumers**: INSZoom CRMCases.jsx, CRMCaseDetail.jsx, Dashboard.jsx, USCISForms.jsx; BAIS Dashboard.jsx, Documents.jsx, postLoginDest.js — 7 distinct pages across both portals.
**Models touched via populate/ref**: Client (unrestricted), User, Beneficiary, CaseForm, Questionnaire, Answer, Document, Payment, Notification.
**Endpoints**: all `/api/cases/*` (case.routes.js), `/api/eligibility/*`, `/api/cases/:caseId/forms/*` (autoFillRoutes), `/api/canonical/cases/:caseId/*`, `/api/cases/:caseId/timeline` (shadowed).
**Circular-dependency flag**: CanonicalProfileService.rebuild() loads and saves its own independent copy of a Case document (only given the id) — the in-code comment at `immigration-knowledge-engine.service.js:476-482` documents this bumps `__v` underneath any other in-flight caseData mutation, which is a real (not hypothetical) VersionError source distinct from the confirmed auth-refresh one.
**Change blast radius**: **CRITICAL** (see `impact/case-model.mmd` for the full graph and scoring methodology).
**Evidence**: E021, E022, E026, E030, E031, E032 in `dependency-graph.json`.

---

### MODULE: User (model)
**File**: `Backend/src/models/User.js`
**Collection**: `users`
**Direct consumers**: authenticate.js (every authenticated request, ~337/350 routes), auth.service.js, case.service.js (canAccessCase), beneficiary.service.js / company.service.js (blanket-staff fallback — weaker scoping than Case), user.service.js, rbac.service.js, notification.service.js, message.service.js, workflow.service.js.
**Dangling reference**: 14 `ref:"Team"` declarations across 13 models (including `User.js:29` itself) point at a model that is never registered anywhere in the backend — latent `MissingSchemaError` risk if any of those paths is ever populated.
**Change blast radius**: **CRITICAL** — widest fan-in of any model (every authenticated request). See `impact/user-model.mmd`.
**Evidence**: E012, E016 in `dependency-graph.json`.

---

### MODULE: CaseForm (model)
**File**: `Backend/src/models/CaseForm.js`
**Collection**: `caseforms`
**Index coverage**: 16 declared indexes (well under the 64 cap) — genuinely adequate; the historically-diagnosed sort-memory bug is fixed (both `{caseId,updatedAt:-1}` and bare `{updatedAt:-1}` exist, covering both the filtered and unfiltered list sorts).
**Growth risk**: `versions[]` is uncapped and each entry embeds a **complete copy** of `filledData`/`fieldValues`/`sourceAttribution`/`validationErrors` — every regeneration/autofill run pushes one more full-payload snapshot, trending toward the 16MB BSON limit for actively-edited forms.
**Direct consumers**: uscis-form.service.js, interactive-form-review.service.js, AutoFillService.js, FormMappingService.js, requireCaseFormAccess.js.
**Confirmed live behavior**: the field-save reload query (`interactive-form-review.service.js:396`, `CaseForm.findById`) has **no `.maxTimeMS()`**, unlike the initial read one hop earlier — this is the specific gap that turns a dead pooled connection into the reproduced "Save failed" 503 (see `errors/forms-save-503.mmd`).
**Evidence**: E040, E041, E043, E053.

---

### MODULE: USCISFormTemplate (model)
**File**: `Backend/src/models/USCISFormTemplate.js`
**Collection**: `uscisformtemplates` (7 live documents)
**Size**: the model's own code comments describe individual documents as approaching MongoDB's 16MB subdocument-array ceiling (`formFields[]`, 75 sub-fields each incl. coordinates/widgets/appearance/mappings, plus `sections[]`, `mappingGraph`, `pdfFieldMappings[]`, `mappingAuditHistory[]`).
**Confirmed live measurement**: `GET .../workspace` (which populates this model excluding only the `-definition` field) returned **19,653,489 bytes** in one response this session.
**Direct consumers**: uscis-form.service.js (populated at 3+ distinct read paths with varying — sometimes zero — projection), `activeTemplatesCached` (correctly `.lean()` + projected + TTL-cached).
**Change blast radius**: HIGH for payload-size reasons specifically — any code path that populates this model without a tight `.select()` risks multi-megabyte responses.
**Evidence**: E044.

---

### MODULE: AuthSession (model)
**File**: `Backend/src/models/AuthSession.js`
**Collection**: `authsessions`
**Confirmed defect**: default Mongoose `__v` versioning with no override; `session.service.js`'s `rotateSession()` performs an unguarded find→create→save sequence with no app-level lock — **this is the confirmed root cause of the live auth-refresh 500** (see `errors/auth-refresh-500.mmd`).
**Change blast radius**: MODERATE (touches only the auth/session subsystem), but SEVERITY is HIGH because it directly produces a reproducible user-facing 500 and silently orphans valid sessions.
**Evidence**: E014, E015, E016.

---

### MODULE: errorHandler (middleware)
**File**: `Backend/src/middleware/errorHandler.js`
**Role**: the single chokepoint that decides 503 vs 500 vs other for every unhandled error in the app.
**Confirmed scope**: `isDatabaseUnavailableError()` matches exactly 7 Mongo/Mongoose driver error class names + error code 50 (`MaxTimeMSExpired`) — verified narrow and precise, **not** a source of false-503 laundering.
**Confirmed gap**: `VersionError`, `CastError`, `ValidationError`, and duplicate-key (11000) errors are **not** in any branch — all fall through to the generic 500 default, which is why the auth-refresh race (a `VersionError`) surfaced as 500 rather than something more diagnostic, and why a malformed case ID surfaces as 500 instead of 400/404.
**Change blast radius**: CRITICAL by design (every unhandled error in the entire backend flows through this one function) — the highest-leverage single file to fix for the "unverified" tail of Root-Cause Ranking below (status-code correctness).
**Evidence**: E016, and the STATUS-CODES-ERRORS dimension findings in full.
