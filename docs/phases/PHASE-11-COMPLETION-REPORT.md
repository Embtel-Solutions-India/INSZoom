# Phase 11 Completion Report

PHASE 11 STATUS: INCOMPLETE

## A. Phase Reports Analyzed

Read and applied the architecture from Phase 1 through Phase 10 reports. Key conclusions:

- Phase 2 introduced profile provenance schemas and mapping-edge ownership metadata.
- Phase 9 made System B authoritative for new employer/employee and family workflows.
- Phase 9 explicitly left canonical pipeline sync as follow-up.
- Phase 10 locked down employee/beneficiary portal RBAC and must not be weakened.

## B. Implementation Summary

Implemented the core Phase 11 foundation:

- Extended profile field provenance.
- Hardened centralized profile field writes.
- Added conservative profile/canonical crosswalk.
- Fed System B profiles into `CanonicalBuilderService`.
- Added guarded native form edit reverse-sync to existing System B profiles.
- Preserved existing `USCISMappingVersion` graph architecture.

## C. Files Modified

- `Backend/src/models/EmployerProfile.js`
- `Backend/src/models/EmployeeProfile.js`
- `Backend/src/utils/canonicalFieldWriter.js`
- `Backend/src/modules/employer-profile/employer-profile.service.js`
- `Backend/src/modules/employer-profile/employer-profile.controller.js`
- `Backend/src/modules/employee-profile/employee-profile.service.js`
- `Backend/src/modules/employee-profile/employee-profile.controller.js`
- `Backend/src/modules/canonical/services/CanonicalBuilderService.js`
- `Backend/src/modules/form-mapping/services/AutoFillService.js`
- `Backend/src/modules/form-mapping/services/FormMappingService.js`
- `Backend/src/modules/form-mapping/services/MappingResolver.js`
- `Backend/src/modules/uscis-forms/interactive-form-review.service.js`

## D. Files Created

- `Backend/src/modules/canonical/config/profileCanonicalMap.js`
- `Backend/src/utils/tests/canonicalFieldWriter.phase11.test.js`
- `Backend/src/modules/canonical/tests/phase11.profileCanonicalMap.test.js`
- `docs/phases/phase-11/PHASE-11-COMPLETION-REPORT.md`

## E. Canonical Field Model

Profile fields now support:

- value, source, sourceId, sourceField
- updatedAt, updatedBy, revision
- locked, conflictPending
- profileOwner, caseScope
- lastChangeId, history

## F. Ownership Enforcement

Employer fields are scoped by principal case. Employee and beneficiary fields are scoped by the exact child case. Reverse sync uses ObjectId relationships and existing profile documents; it does not parse case numbers.

## G. Locks and Conflicts

Locked or staff-owned fields cannot be overwritten by questionnaire, OCR, or import. The incoming value is stored in `conflictPending`.

## H. Revision Control

The writer accepts expected field revisions. Stale revisions do not overwrite current values and create pending conflicts.

## I. Sync Loop Prevention

Form-originated writes use `form_edit` plus a stable change id. Duplicate change ids do not increment revision or append history.

## J. Legacy Answer Handling

Legacy `Answer` remains compatibility data only. Phase 11 does not blindly write profile data into `Answer`, and the crosswalk explicitly refuses raw `raw.questionnaireAnswers.*` reverse mappings.

## K. Mapping Architecture

The implementation extends `USCISMappingVersion` graph edges and existing mapping services. No duplicate mapping engine or replacement `FormTemplate.fieldMappings` system was introduced.

## L. Tests

Passed:

- `node --test Backend/src/utils/tests/canonicalFieldWriter.phase11.test.js`
- `node --test Backend/src/modules/canonical/tests/phase11.profileCanonicalMap.test.js`

## M. Verification

Passed syntax checks on modified backend core files. Full database-backed end-to-end tests were not run in this environment.

## N. Remaining Gaps

Phase 11 remains incomplete because:

- Full approved crosswalk coverage for every production form field is not yet complete.
- Profile conflict resolution needs a dedicated staff API/UI.
- End-to-end DB tests for profile -> canonical -> form -> profile are still pending.
- OCR-to-System-B profile ingestion remains future work.

## O. Phase 10 Preservation

No Phase 10 restricted portal exposure was loosened. Restricted users still cannot access parent/sibling/internal case data through the Phase 11 implementation.

## P. Final Verdict

Phase 11 foundation is implemented, but the phase is honestly marked incomplete until approved full crosswalk coverage and end-to-end database verification are completed.

## Q. Consolidated Phase 11 Plan

Phase 11 connects the Phase 9 System B profile store to the existing USCIS form pipeline without replacing the working mapping graph architecture.

System B remains authoritative for the new workflow:

- Principal Case owns `EmployerProfile`.
- Employee or Beneficiary child Case owns exactly one `EmployeeProfile`.
- Legacy `Answer` remains compatibility input only.
- USCIS forms continue to use `USCISMappingVersion` graph edges and `AutoFillService`.

Implementation plan executed:

- Extend existing profile field provenance instead of creating a second canonical store.
- Harden `canonicalFieldWriter` for source identity, field revisions, locks, conflict state, change-id idempotency, and per-field history.
- Add a conservative profile-to-canonical crosswalk for confirmed System B fields only.
- Extend `CanonicalBuilderService` so `EmployerProfile` and the exact child `EmployeeProfile` feed `Case.canonicalProfile` as canonical candidates.
- Extend direct native form edit reverse-sync so safe direct mappings also write back to the relevant System B profile.
- Preserve Phase 10 RBAC boundaries.

## R. Consolidated Architecture

For new System B cases, the authoritative business data lives in:

- `EmployerProfile` for principal/employer-owned data.
- `EmployeeProfile` for each employee or beneficiary child case.

`Answer` documents are compatibility records for older questionnaire and form workflows. They are not the long-term source of truth.

Profile to form:

1. `EmployerProfile` and `EmployeeProfile` feed `CanonicalBuilderService`.
2. `CanonicalBuilderService` writes `Case.canonicalProfile`.
3. `CanonicalDataService` exposes canonical data to `AutoFillService`.
4. `AutoFillService` maps values through `USCISMappingVersion` graph edges.

Form to profile:

1. Native form edit calls `AutoFillService.overrideField`.
2. Existing reverse index resolves a direct canonical path.
3. `CanonicalProfileService.applyStaffEdit` updates legacy `Case.canonicalProfile`.
4. Phase 11 additionally writes a `form_edit` into `EmployerProfile` or the exact child `EmployeeProfile` when the path is safely mapped.

Safety rules:

- Employer-owned fields fan out through canonical data but remain owned by `EmployerProfile`.
- Employee and beneficiary fields are scoped to one child case only.
- Relationship resolution uses ObjectId fields, never parsed `caseNumber` strings.
- Client requests cannot spoof `case_manager_edit` or `form_edit`.
- A locked or staff-owned field cannot be silently overwritten by questionnaire, OCR, or import.
- Stale field revisions create pending conflicts instead of overwrites.
- Raw legacy `raw.questionnaireAnswers.*` paths are not reverse-mapped to profiles unless an approved crosswalk exists.

## S. Consolidated Canonical Field Crosswalk

This is the approved Phase 11 starter crosswalk. It is intentionally conservative. It maps only confirmed System B profile fields to canonical paths already used by the USCIS form pipeline.

Legacy `raw.questionnaireAnswers.*` paths are not mapped here. They require a separate approved question-key crosswalk and must not be guessed.

EmployerProfile to canonical:

| Profile field | Canonical path |
| --- | --- |
| `legalName` | `company.name` |
| `dbaName` | `company.dbaName` |
| `ein` | `company.ein` |
| `businessType` | `company.industry` |
| `businessDescription` | `company.description` |
| `yearEstablished` | `company.yearEstablished` |
| `grossAnnualIncome` | `company.grossAnnualIncome` |
| `netAnnualIncome` | `company.netAnnualIncome` |
| `numberOfEmployees` | `company.numberOfEmployees` |
| `address.street` | `company.address.line1` |
| `address.street2` | `company.address.line2` |
| `address.city` | `company.address.city` |
| `address.state` | `company.address.state` |
| `address.zipCode` | `company.address.zip` |
| `address.country` | `company.address.country` |
| `contact.name` | `company.contact.name` |
| `contact.title` | `company.contact.title` |
| `contact.phone` | `company.contact.phone` |
| `contact.email` | `company.contact.email` |

EmployeeProfile / BeneficiaryProfile to canonical:

| Profile field | Canonical path |
| --- | --- |
| `firstName` | `person.firstName` |
| `middleName` | `person.middleName` |
| `lastName` | `person.lastName` |
| `dateOfBirth` | `person.dob` |
| `gender` | `person.gender` |
| `countryOfBirth` | `person.countryOfBirth` |
| `countryOfCitizenship` | `person.citizenship` |
| `nationality` | `person.citizenship` |
| `maritalStatus` | `person.maritalStatus` |
| `email` | `contact.email` |
| `phone` | `contact.phone` |
| `currentAddress.street` | `contact.address.line1` |
| `currentAddress.city` | `contact.address.city` |
| `currentAddress.state` | `contact.address.state` |
| `currentAddress.zipCode` | `contact.address.zip` |
| `currentAddress.country` | `contact.address.country` |
| `passport.number` | `person.passport.number` |
| `passport.country` | `person.passport.country` |
| `passport.issueDate` | `person.passport.issueDate` |
| `passport.expirationDate` | `person.passport.expirationDate` |
| `currentVisaStatus` | `immigration.currentStatus` |
| `i94Number` | `immigration.i94.number` |
| `i94ExpirationDate` | `immigration.i94.expirationDate` |
| `alienRegistrationNumber` | `person.alienNumber` |
| `sevisId` | `immigration.sevis.id` |

Explicit non-mappings:

- `raw.questionnaireAnswers.*`
- composite full names unless the mapping is direct and reversible
- checkbox or conditional mappings
- derived values such as calculated age
- occurrence-specific fields unless `allowsOccurrenceOverride` is explicitly approved

## T. Consolidated Sync Matrix

| Source | Target | Behavior |
| --- | --- | --- |
| Client questionnaire | Profile field | Applies if field is not locked and not staff-owned. |
| OCR | Profile field | Applies if field is not locked and not staff-owned. |
| Import | Profile field | Applies if field is not locked and not staff-owned. |
| Case manager edit | Profile field | Applies, locks field, clears pending conflict. |
| Native form edit | Case canonical profile | Applies through existing reverse-sync path when direct. |
| Native form edit | System B profile | Applies as `form_edit` only when direct canonical path maps to an existing profile field. |
| Profile field | USCIS form | Flows through `CanonicalBuilderService`, `CanonicalDataService`, mapping graph, and `AutoFillService`. |

Existing CaseForm field sync states remain:

- `SYNCED`
- `MANUAL_OVERRIDE`
- `CONFLICT`

## U. Consolidated Conflict Matrix

| Existing state | Incoming source | Incoming differs? | Result |
| --- | --- | --- | --- |
| unlocked questionnaire/OCR/import | questionnaire/OCR/import | yes | apply, increment revision |
| locked field | questionnaire/OCR/import | yes | keep current value, set `conflictPending` |
| staff-owned field | questionnaire/OCR/import | yes | keep staff value, set `conflictPending` |
| any field | case manager edit | yes | apply, lock, clear `conflictPending` |
| any field | form edit | yes | apply, lock, clear `conflictPending` |
| any field | stale expected revision | any | keep current value, set `conflictPending` |
| duplicate `changeId` | any | any | no revision increment |

Native form field conflicts continue through the existing interactive review resolution path. Profile field conflicts are stored on the field and require a staff resolution workflow. A dedicated profile-conflict UI/API is still a follow-up item.

## V. Consolidated Test Matrix

| Test | Status |
| --- | --- |
| Canonical writer records sourceId/sourceField/owner/scope/history | PASS |
| Locked field blocks client overwrite | PASS |
| Staff-owned field blocks client overwrite | PASS |
| Stale field revision creates conflict | PASS |
| Duplicate changeId is idempotent | PASS |
| Client cannot spoof `case_manager_edit` | PASS |
| Staff may write `form_edit` | PASS |
| Profile crosswalk maps known System B fields | PASS |
| Crosswalk refuses raw legacy Answer paths | PASS |
| Full profile -> canonical -> USCIS form DB integration | PENDING |
| Native PDF edit -> profile DB integration | PENDING |
| Profile conflict resolution API/UI | PENDING |
| Complete approved mapping for all production form fields | PENDING |
