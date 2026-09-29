# Form Governance Admin Page — Upload, Replace, Approve, Mapping Review

**Date:** 2026-09-27 – 2026-09-29
**Status:** COMPLETE

## 0. Objective

A single Admin page where an operator can see every USCIS form the system knows about (fetched or not), review/build its field-to-canonical-data mapping, approve and activate an edition for real cases, upload a brand-new form or replace an existing form's PDF with a new edition — all using the *existing* import/mapping/lifecycle services, not a parallel system.

---

## 1. New pages

**`Admin/frontend/src/pages/FormGovernance.jsx`** — catalog list. One row per real form code: fetch status (fetched / not fetched / not fetchable-wrong-agency / fetch failed), template edition status, mapping/autofill status, every visa type that uses it with **Automatic/Conditional** labeling, and actions (Open PDF, Fetch from USCIS.gov, Review mapping). Includes supplement/component forms (e.g. I-129's H/E Classification Supplements), correctly tagged and routed to their parent's mapping page since they share its template.

**`Admin/frontend/src/pages/FormGovernanceDetail.jsx`** — per-form page:
- Field mapping table: every PDF field with a dropdown to pick its canonical data source, "Auto-suggest mappings" (runs the existing scorer), live mapped/unmapped/needs-review counts.
- **Approve mapping** — activates the mapping once every field is mapped (existing `MappingGraphService.activate()`).
- **Approve edition** / **Activate for real cases** — the missing piece: the existing USCIS-edition approve/activate endpoints (`PUT /uscis-forms/:id/approve`, `/activate`) had no UI button at all before this; "Activate" now correctly stays disabled until both the edition is approved *and* the mapping is fully active.
- **Autofill preview** — paste a real Case ID, see what values the current mapping would actually produce, without writing anything (reuses `AutoFillService.preview`).
- **Add case type** — creates a new `VisaFormMapping` row (visa type + Automatic/Conditional) via the existing per-template mapping CRUD.
- **Replace Form** — upload a new PDF for this same form code; existing case-type associations keep resolving automatically (they're keyed by form code string, re-resolved live, not by template `_id`).
- Pending-edition banner: since Replace deliberately creates a second document under the same form code, the page shows "a newer draft is awaiting review" and lets the operator toggle between reviewing the active edition and the pending one, rather than one silently hiding the other.

**`Admin/frontend/src/components/UploadFormModal.jsx`** — shared by both "Upload Form" (any new form code) and "Replace Form" (locked to the existing form's code): pick a PDF → Analyze (qpdf normalize, validate, scan, all pre-existing) → review disposition (new form / new edition / exact duplicate / form-code mismatch) → Publish. Reuses `POST /uscis/forms/analyze` and `/upload` verbatim — no new PDF-processing logic.

**Backend additions**, all thin wrappers over existing services: `GET /api/form-registry/catalog`, `POST /api/form-registry/catalog/:formCode/fetch` (`Backend/src/modules/form-registry/form-registry.controller.js`, `registry-lookup.routes.js`); `GET /form-mappings/templates/:templateId/autofill-preview` (`Backend/src/modules/form-mapping/controllers/MappingGraphController.js`).

## 2. Real bugs found and fixed along the way

1. **Mapping-version collision (500 error).** `MappingGraphService.persistVersion()` trusted `template.mappingVersion` as the next sequence number without checking what was actually persisted in `USCISMappingVersion`. Reproduced live, fixed by reconciling against the real max on file, with a retry on an actual duplicate-key race.
2. **16MB document overflow.** Persisting the full mapping graph onto the (already ~15.85MB, 980-field) `USCISFormTemplate` document pushed saves past MongoDB's document limit. Fixed by never writing `template.mappingGraph` — every reader now loads the current graph from `USCISMappingVersion` (a separate, per-version document) via a new `loadCurrentGraph()` helper.
3. **Duplicate-formCode ambiguity.** More than one `USCISFormTemplate` can share a form code (e.g. right after Replace Form publishes a new draft alongside the still-active prior one). The catalog builder's `find()` had no tiebreak, picking whichever Mongo returned last — **the same ambiguity that let an earlier bulk mapping-generation script silently corrupt the production I-129 template's field mappings**, demoting its curated, fully-active mapping to a lower-quality auto-generated one. Both are now fixed: the catalog deterministically prefers the active, in-service template, and the corrupted I-129 mapping was repaired and re-verified (`h1b-i129-mapping.test.js` back to 9/10 passing — the 10th is a pre-existing, unrelated gap, confirmed via isolation).
4. **Catalog visibility gap.** The catalog was built by walking `VisaFormMapping` registry rows, so a freshly uploaded form with no case-type association yet was invisible. Fixed: every `USCISFormTemplate` is enumerated first, with registry associations layered on top — an unmapped form now shows with an empty "Used by" list instead of not existing.

## 3. Verification

- Live end-to-end: fetched I-829/I-956F from uscis.gov, built and activated a real field mapping, confirmed catalog/detail pages reflect it correctly.
- `MappingGraphService.test.js` (11/11), `h1-i129-mapping.test.js` (9/10, 1 pre-existing unrelated), `form-registry` suite (35/35), full frontend build clean throughout.

## 4. What was explicitly not done

- No automatic/bulk activation of any mapping — every activation in this system is a human clicking Approve/Activate, by design (the codebase's own "Constraint #3" human-review gate for legal-form correctness was never bypassed).
- No changes to XFA handling (confirmed it's a rendering-pipeline concern, not an import-pipeline one — the import pipeline never calls `.save()` on a loaded PDF, so it never triggers pdf-lib's XFA-stripping warning in the first place).
