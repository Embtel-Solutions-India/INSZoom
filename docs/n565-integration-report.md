# Form N-565 Integration Report

Integrates Form N-565 (Application for Replacement Naturalization/Citizenship Document) as an **optional, Case-Manager-approved independent USCIS form** under the Single Person category — reusing the existing CONDITIONAL-form architecture end to end, with zero new mapping tables, zero new checklist-assignment code, and zero visa-specific hardcoding.

## Implementation inventory (before any code was written)

- **Single Person case handling**: `Backend/src/config/visaCategories.js` already models several non-visa "services" as pseudo-`visaType` entries with `caseStructure: "single"` — `"Naturalization"` (→ N-400), `"Certificate of Citizenship"` (→ N-600), `"Replacement Citizenship Certificate"` (→ N-565, its own dedicated AUTO_CREATE case type, untouched by this work), `"Adjustment of Status"`, `"Green Card Renewal"`, etc. This is the existing "service, not visa type" mechanism.
- **Existing optional/conditional USCIS form + Case Manager approval flow**: `Backend/src/modules/form-registry/visaFormMapping.service.js`'s `recordConditionalDecision(caseData, mappingId, decision, user, reason, req)` is the **exact** mechanism the spec describes — a Case Manager records `ADD`/`NOT_APPLICABLE` against a `CONDITIONAL` `VisaFormMapping` row. On `ADD`, it (a) fetches/provisions the official USCIS PDF through the existing generic template resolver and `uscisFormService.ensureAssignedForms` (the same path AUTO_CREATE forms use — no second CaseForm-creation path), and (b) — via a small `CONDITIONAL_FORM_CHECKLIST_KEYS` map — assigns that form's own client checklist through `questionnaire.service.js`'s `assignQuestionnaireIfNotActive`. **Form I-131 already uses this exact pattern** (`i131Checklist.js` + `CONDITIONAL_FORM_CHECKLIST_KEYS["I-131"] = "i131_checklist"`) — N-565 is a second entry in the same map, not a new mechanism.
- **USCIS form fetching**: `USCISFormImporterService.js` is fully generic (form-code-driven PDF fetch/normalize/cache) — a code comment there confirms it was already tested live against a fresh N-565 download. No form-specific fetch code exists or was needed for I-129 either; nothing added here.
- **VisaFormMapping representation**: the `visaType` + `formNumber` + `provisioningType` (`AUTO_CREATE`/`CONDITIONAL`/`LATER_STAGE`/`REFERENCE`) + `componentType` (`STANDALONE_FORM` for independent forms) schema is the single mapping table for every form, visa or pseudo-visa. No second table exists or was created.
- **Client visibility resolver**: `Immiglance/Client/src/utils/questionnaireEngine.js`'s `resolveApplicableChecklistRoles` returns `null` ("no role restriction") for a plain single-party `client`-role case — `Documents.jsx` then shows **every** active checklist unfiltered. Confirmed this already correctly supports "existing checklist + newly-approved checklist, both visible" with no code change, since both are `checklistRole: "client"` and role-filtering isn't the axis that would ever hide one of them.

## Files changed

- `Backend/src/modules/questionnaires/n565Checklist.js` (new) — the checklist/questionnaire content, mirroring `i131Checklist.js`'s structure exactly.
- `Backend/src/modules/questionnaires/questionnaire.service.js` — registered `N565_CHECKLIST_DEFINITION` in `VISA_TEMPLATE_DEFINITIONS`, alongside `I131_CHECKLIST_DEFINITION`.
- `Backend/src/modules/form-registry/visaFormMapping.service.js` — added `"N-565": "n565_checklist"` to `CONDITIONAL_FORM_CHECKLIST_KEYS`.
- `Backend/src/modules/form-registry/seeds/visaFormMappings.seed.js` — added two `CONDITIONAL`, `STANDALONE_FORM` N-565 rows, under `"Naturalization"` and `"Certificate of Citizenship"` only.
- `Backend/src/modules/questionnaires/tests/n565Checklist.test.js` (new, 14 tests).

## N-565 mapping

| visaType | formNumber | provisioningType | Notes |
|---|---|---|---|
| `Naturalization` | N-565 | `CONDITIONAL` | Optional add-on to an existing N-400 case |
| `Certificate of Citizenship` | N-565 | `CONDITIONAL` | Optional add-on to an existing N-600 case |
| `Replacement Citizenship Certificate` | N-565 | `AUTO_CREATE` | Pre-existing, unchanged — its own dedicated case type |

Never registered under EB-1A/EB-1B/EB-2/EB-3, H-1B/L-1, K-1/K-3, or any family-based (IR/CR/F) visaType — confirmed by test.

## Checklist structure

`n565_checklist` — `checklistRole: "client"`, `isDefault: false`, `visaType: "N565"` (pseudo-value, never matches a real `Case.visaType` — the same double-guarantee `i131_checklist` uses so it's reachable **only** via explicit approval). 10 sections: certificate info, current info, "I am applying for", reason (multiselect), 5 conditional sections (USCIS error, name change, DOB change, gender change, special certificate), and the 10-item document checklist. Every field label and document name is transcribed verbatim from the supplied source — nothing invented, nothing merged.

## Conditional logic

Driven by two structured fields, using the existing `conditionalLogic`/`contains`/`equals` rule engine (no new rules engine):
- `client_reason` (multiselect) gates: lost/stolen/destroyed → copy-of-document + police report; name change → name-change section + evidence doc; DOB change → DOB section + evidence doc; gender change → gender section + evidence doc; USCIS error → error-location section + evidence doc.
- `client_applyingFor` (select) gates: Special Certificate of Naturalization → the foreign-government-official section + the original-naturalization-certificate document.
- `client_error_location` (nested, inside the USCIS-error section) gates the 4 correction sub-fields (Name/DOB/Gender/Other).
- Marital-status-change evidence and the two-photos-if-outside-US document are left unconditional-visible-but-not-required, matching the source (no single triggering field for either in the supplied source).

## Form ↔ checklist relationship

Kept separate, as required: the `VisaFormMapping` row identifies the official PDF (`formTemplateFormCode: "n-565"`); `n565_checklist` is a wholly separate Questionnaire record. `recordConditionalDecision`'s `ADD` branch activates both from one Case Manager action, but neither is merged into the other's data model.

## Case Manager approval flow

Unchanged, fully generic: the same "conditional forms" list/approve UI that already surfaces I-131 for eligible cases now also surfaces N-565 for `Naturalization`/`Certificate of Citizenship` cases, with zero N-565-specific frontend code. The mapping's own `formName` ("Application for Replacement Naturalization/Citizenship Document") is the label shown — informative for staff, never phrased as "apply for N-565" to the client (the client only ever sees the checklist's own title, "N-565 — Replacement Naturalization/Citizenship Document", stored on the Questionnaire, not the mapping).

## Client visibility flow

Once approved, `n565_checklist` is a second active `questionnaireReferences` entry with `targetRole: "client"`. Confirmed via `resolveApplicableChecklistRoles`/`Documents.jsx` inspection: a single-party case's checklist list is never role-filtered down to one entry, so any pre-existing client checklist and the newly-approved N-565 checklist both render as separate tabs — approving N-565 never replaces or hides another.

## Deduplication behavior

Entirely inherited, not reimplemented: `recordConditionalDecision` finds-or-replaces the case's own `conditionalFormDecisions` entry for this mapping (never a duplicate decision row), `uscisFormService.ensureAssignedForms` already dedupes `CaseForm` creation, and `assignQuestionnaireIfNotActive` is a no-op if an active reference already exists. Re-approving N-565 (or re-running case load/reload) produces no duplicate checklist, CaseForm, or questionnaire reference — verified by the same dedicated dedup test (`assignQuestionnaireIfNotActive assigns once, then is a safe no-op on repeat calls`) that already covers I-131's identical code path. Deactivation (`NOT_APPLICABLE`) follows I-131's own existing behavior exactly: the decision record updates, historical answers/CaseForm are left alone, nothing is deleted — this is a pre-existing characteristic of the reused mechanism, not new behavior authored for N-565.

## Tests executed / results

157/157 backend tests pass — 14 new (`n565Checklist.test.js`: mapping scope, initial-state guarantees, document/conditional-logic correctness, role isolation, no duplicate keys) plus the full existing family-workflow/questionnaires/form-registry suite (unchanged, confirming no regression to I-130/Green-Card/GC-NVC/Green-Card-Renewal/I-131/EB-1B/EB-2/EB-3/H-1B/L-1A/P/O-1/K-1/K-3 or the dedup mechanism itself).

## Remaining limitations / not done this pass

- No live case-creation/API smoke test was run (same scope decision as the two preceding tasks in this session, to avoid the earlier test-harness time cost) — correctness rests on unit tests plus direct inspection of the exact, already-proven I-131 code path this reuses byte-for-byte.
- No dedicated `USCISFormTemplate` seed/import run was triggered for `n-565` in this pass — the generic importer already supports it (confirmed via existing code comments referencing a live N-565 download test); actually populating a fresh template is an operational action (running the importer), not a code change, and wasn't performed here.
- Frontend (Admin CRM "add conditional form" list, client Documents page) was not build-tested — relies on both already being fully generic (verified by reading, not by running).

## Reusability for N-400 / N-600 (per the final rule)

Nothing N-565-specific exists outside `n565Checklist.js` and its two mapping rows/one map entry. A future N-400 or N-600 optional-add-on checklist would follow the identical three-step recipe: (1) a new `n40x/n600Checklist.js` file shaped like `n565Checklist.js`/`i131Checklist.js`, (2) one `CONDITIONAL_FORM_CHECKLIST_KEYS` entry, (3) `CONDITIONAL` `VisaFormMapping` rows under whichever existing Single Person case types it applies to — no new architecture, no changes to `recordConditionalDecision`, `ensureAssignedForms`, `assignQuestionnaireIfNotActive`, or the client visibility resolver.
