# Case Manager-Controlled USCIS Forms and Generic Autofill

**Status: implemented (Phases 1-5). Decisions taken with the product owner: new cases keep today's automatic defaults until a Case Manager takes control; selections live in a dedicated `CaseFormSelection` collection; removal archives and keeps everything, a package-required form is acknowledged as "waived".**

Everything under "Verified" was read in the code. Test results are in section 9 and are the real results of the runs, including what could not be run.

---

## 1. Verified architecture (before the change)

### 1.1 What decided which forms a case got
`uscis-form.service.js ensureAssignedForms` is the main creator of `CaseForm` records. It merged three sources, first match per form code wins: the legacy template scan (`latestTemplatesByAssignmentRules` -> `templateAppliesToCase`, skipped for Family cases), the hard-coded conditionals (I-907, G-28, I-539, I-539A) and the registry (`registryAutoCreateTemplates`; `CONDITIONAL` and `LATER_STAGE` rows are auto-created too, not only `AUTO_CREATE`). It then reconciled conditional forms, created the `CaseForm`, pushed `Case.uscisFormReferences` and linked components to their parent.

### 1.2 Every path that creates a CaseForm
| Path | Notes |
|---|---|
| `ensureAssignedForms` | case creation, assignment/transfer, GHL import, family and employer workflows, "Generate USCIS Forms", client-intake submit and OCR approval (`tryGenerateForms`), registry Add / single-form Add, on-demand acquire, admin bulk apply, H-4 filing change, I-907 upgrade, N-400/N-600 add-ons, scripts |
| `createCaseForm` (`POST /uscis-forms/case/:caseId`) | upsert, no applicability check |
| `AutoFillService.generate` | creates a CaseForm when none exists for `(caseId, formCode)` |
| `OnDemandFormAcquisitionService.acquireForCase`, biographic branch | upsert |

### 1.3 Removal before the change
There was **no way to remove a form** (no endpoint, no button, no app-code delete). The only archiver was `reconcileConditionalForms`, which skips every form that has a `provisioning` record. `NOT_APPLICABLE` only stored a decision.

### 1.4 Per-case decisions before the change
`Case.conditionalFormDecisions[]` (ADD / NOT_APPLICABLE), keyed by registry mapping id, for Conditional registry rows only. Nothing for supplements, components or "exclude a form that auto-creates".

### 1.5 Findings that shaped the design
1. Archived forms were counted by progress metrics, packages, petition assembly and the Word package, so one removed form would have blocked "all forms generated / locked" and the filing package.
2. `generateForms` re-autofilled archived forms and `AutoFillService.generate` set them back to `ai_filled`, silently un-archiving them.
3. Petition validation reported a missing required form as `FORM_NOT_FOUND`.
4. Forms can appear after case creation (client-intake submit, OCR approval, any registry change, assignment).
5. Three access-check gaps on the form surface (`GET /uscis-forms/case`, `POST /forms/packages/generate`, `POST /cases/:id/uscis-form-references`).
6. The generic autofill path already exists: checklist answer -> `Answer` -> `CanonicalBuilderService` (`question.mapping.canonicalPath`) -> `Case.canonicalProfile` -> a form's mapping graph -> `AutoFillService.generate`. **No per-visa autofill code is needed**; what varies per form is mapping coverage.

---

## 2. Authority model (what was built)

### 2.1 Data
- **`CaseFormSelection`** (`models/CaseFormSelection.js`): one row per `(caseId, formCode, componentCode)`, unique index. `decision` include | exclude, `selectionStatus` (selected / pending_acquisition / provisioned / removed / failed), `caseFormId`, edition at selection, `waivedRequirement`, reason, actor, timestamps, `revision`, `history[]`. `caseId` is the case that OWNS the forms (a container's child case).
- **`Case.formSelectionMode`** (`legacy` default | `manual`) and **`Case.formSelectionRevision`** (optimistic concurrency).
- `CaseForm` is unchanged.

### 2.2 One authority check (`uscis-forms/case-form-selection.service.js`)
`isFormAllowed` / `filterAllowedTemplates` / `assertFormAllowed`, called by **all four** creation paths:
- an explicit **exclude always wins**, in every mode, over every automatic rule (template scan, registry, hard-coded conditionals, checklists, GHL, scripts). A component whose parent is excluded is excluded unless it was explicitly included;
- `legacy` mode (every existing case): unchanged, except for exclusions;
- `manual` mode: only forms with an explicit include are created; case creation still succeeds with an empty selection;
- a missing row is never an exclusion; a component needs its own include (selecting a parent does not select its components);
- a case nobody ever touched (revision 0, legacy) skips the lookup entirely - no extra query, no behavior change.

Explicit staff actions (registry Add, Add decision, on-demand acquire, `createCaseForm`) record an include so the authority and the case agree; for an untouched case this is a no-op.

### 2.3 Active forms and removal
- One definition of an **active form** (`ACTIVE_FORM_FILTER`: not archived). Used by progress metrics, `generateForms`, `generatePackage`, the filing package, the Word package, the all-forms-locked check, the filing snapshot and petition assembly.
- **Remove** = an `exclude` row + the `CaseForm` is **archived, never deleted** (record, answers, history, provenance, PDFs kept). Rules: an empty draft goes freely; a form holding data needs confirmation; reviewed / approved needs confirmation and a reason; locked / filed needs a Team Lead or Admin, a reason and confirmation. Removing a parent asks about its components (`cascadeComponents`). Removing a form the filing package requires needs an explicit acknowledgement and is then **waived** (petition validation reports `FORM_WAIVED`, a warning, instead of `FORM_NOT_FOUND`; the form gets no heading in the petition).
- **Restore** brings the same record back with its earlier status and data (no duplicate).
- `AutoFillService.generate` refuses to touch an archived form (409 `FORM_ARCHIVED`) instead of silently reviving it.

### 2.4 Baseline / migration
No bulk migration. The first time a Case Manager changes a case's selection, the case moves to `manual` and a baseline `include` row is written for every non-archived `CaseForm` it already has (idempotent; nothing deleted or changed). Existing cases keep working exactly as before until then.

---

## 3. Catalogue (`uscis-forms/case-form-catalog.service.js`)
Built from `USCISFormTemplate`, `VisaFormMapping` and `USCISFormComponentDefinition`; **independent of any visa mapping**. An entry is listed only when it is verifiably USCIS (registry agency USCIS, or the template was acquired from uscis.gov); anything the registry attributes to another agency (DS-160, DS-260, ETA-*, ...) is never offered; forms with neither signal are `unverified` and not selectable. Each entry has one availability: `ready` (active template + active mapping), `mapping_incomplete`, `no_template`, `not_eligible` (deprecated edition), plus `provisionable` (only an **active** template is ever created on a live case). A form with a template still in review, or no template, is **recorded as `pending_acquisition`** and created when forms are next generated and the template is active - never shown as ready, never created from an unsafe template. Cached for 5 minutes (it reads large template documents) and cleared whenever the template cache is.

Whether the registry contains every official USCIS form cannot be confirmed from the code; the catalogue reports what exists.

---

## 4. API (`/api/case-forms`, staff roles, `canAccessCase` enforced again in the service)
| | |
|---|---|
| `GET /catalog?q&category&kind&availability&limit&offset` | search by number, title words, keyword, category |
| `GET /resolve?name=` | what a typed name resolves to (one form, or the candidates) |
| `GET /cases/:caseId/selection` | selections, automatic forms, removed forms, readiness, revision |
| `PUT /cases/:caseId/selection` | `{targetCaseId, expectedRevision, add:[{name|formCode,componentCode}], remove:[...], assignChecklists, assignChecklistKeys, autofill}`; atomic claim of the revision; per-item results; partial success reported; 409 `STALE_SELECTION_REVISION`, `CONFIRMATION_REQUIRED`, `DEPENDENT_COMPONENTS`, `PACKAGE_REQUIRES_FORM`, `AMBIGUOUS_FORM_NAME` |
| `GET /cases/:caseId/selection/coverage?formCode&checklistKeys` | which checklists feed a form |
| `POST /cases/:caseId/selection/autofill` | re-fill forms (existing autofill) |

A typed name is resolved to exactly one catalogue form; an ambiguous or unknown name is refused with the candidates - never guessed. A component can only be added when its parent is selected or active. Fixed in passing: `GET /uscis-forms/case` (named case must be accessible; unfiltered list is administrators only), `POST /forms/packages/generate` and `POST /cases/:id/uscis-form-references` (caller must be able to access the case).

## 5. Forms and checklists: any form on any visa, any checklist
- **Any form on any visa:** the add path passes the chosen template explicitly (`ensureAssignedForms(..., {templates})`), so `templateAppliesToCase` and the registry's visa mapping are not consulted. A manual selection carries `provisioning.provisioningType = MANUAL_SELECTION`, so the old conditional logic never archives it.
- **The form is filled from the case's checklist answers through the canonical profile:** every checklist question carries a canonical path; a form's mapping reads canonical paths. So any checklist whose questions carry the canonical paths a form reads feeds it, whatever the visa. The coverage endpoint measures this per checklist (fields of the form that checklist can fill) for the case's checklists **and for any checklist the Case Manager is considering**.
- **Linking a checklist:** on Add, the registry-designed checklist for the form (if the case lacks it) is offered and ticked by default, and any other checklist can be chosen; a ticked checklist is assigned to **that case only** (existing assignment: de-duplicated, gated case-manager approval, no change to its case type or other cases).
- Fields no checklist asks about stay empty and are reported; nothing is guessed.

## 6. Autofill report
`autoFillReport.summary` (additive, best-effort): populated, preserved (manual / reviewed), needs client information, needs staff input (required boxes with no mapping), unmapped, kept blank, conflicts, invalid values, `blockers[]` and `status` (`complete` | `needs_attention`). An optional blank box is never a failure. Manual overrides and reviewed values survive every run (existing behavior, unchanged). Limitations: unsupported PDF field types are not evaluated separately; "ambiguous source" is not distinguished from "unmapped" (the mapping graph has one source per box).

## 7. Frontend
`CaseFormSelectionPanel` ("Manage forms" on the Forms tab of `CRMCaseDetail`): a typed Add box with suggestions, availability shown honestly, the checklist coverage of each form to be added (with tick-to-send for the form's own checklist and a search for any other checklist), staged additions and removals reviewed before one Apply, confirmation inputs matching what the server will demand, stale-revision reload, per-form results with the autofill summary, and a "Removed forms" section with Add back. Fixed in passing: the Refresh buttons show progress; the form editor Save stays clickable while saving.

## 8. Rollback
Set `Case.formSelectionMode` back to `legacy` (or ignore the new collection and fields): nothing changed any `CaseForm`. Removing the gate calls restores the old behavior. No production data was modified by this work; the only database writes outside tests were the registry changes made earlier in the session (documented in the session notes).

## 9. Tests executed and their results
See the final report in the conversation; the suites are:
- `uscis-forms/tests/case-form-selection.test.js` (rules, creation path, baseline, active forms, waived)
- `uscis-forms/tests/case-form-selection-manager.test.js` (catalogue, typed add, stale revision, remove / restore, roles, coverage, autofill)
- `uscis-forms/tests/case-form-selection.smoke.test.js` (every provisionable form x 8 visa types; remove / restore x 8 visa types; coverage of ~60 checklists x 4 visa types; checklist assigned once, to one case)
- `uscis-forms/tests/case-form-selection.autofill-e2e.test.js` (checklist answers -> I-130 added by name -> field values, for a family case and an unrelated visa case)
- Admin: `CaseFormSelectionPanel.test.jsx` and the full Admin frontend suite.
All DB tests use the local isolated test database (`mongodb://localhost:27017/immigrationcrm_test`) only.

## 10. Known limitations / remaining work
- Provisioning of a component form needs its parent PDF template to be active; component definitions are empty in the local test database, so components are covered by rules tests, not by an end-to-end DB test.
- Principal (container) cases with several employees: the panel asks which person's forms to manage; selections are per person.
- `Case.uscisFormReferences` is stale by design (never updated); nothing reads it as a source of truth now.
- Petition `buildFormSections` leaves out a waived form; other package consumers use the active-forms filter.
- Official-edition freshness is still enforced by the existing edition controls; this feature does not change them.
